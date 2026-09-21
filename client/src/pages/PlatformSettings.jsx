import { useMemo, useState } from 'react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import SettingsShell from '../components/SettingsShell'
import { buildConsoleSettingsSections, LEGACY_CONSOLE_TABS } from '../lib/consoleSettingsSections'
import PlatformOperators from './PlatformOperators'
import NotificationPrefsPanel from '../components/settings/NotificationPrefsPanel'
import SecurityPanel from '../components/settings/SecurityPanel'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useTheme } from '../context/ThemeContext'

// The console's Settings surface — the operator-side mirror of the tenant
// SettingsShell. It REUSES that shell (one frame, no divergence) and groups the
// two things that are genuinely administration: the operator's own account, and
// (owner-only) who the platform's operators are. Announcements stays a working
// nav item — see the note in lib/consoleSettingsSections.js.
//
// The operator's own profile/appearance are inlined here rather than embedded
// from the old PlatformAccount page, so the whole surface reads as one system
// and the tokens are consistent with the rest of the app. Operators is embedded
// because it is a large page with its own data + modals.
export default function PlatformSettings() {
  const { user } = useAuth()
  const { toast } = useToast()
  const { theme, toggleTheme } = useTheme()
  const isOwner = user?.platform_role === 'owner'
  const [tab, setTab] = useState('profile')
  const SECTIONS = useMemo(() => buildConsoleSettingsSections(isOwner), [isOwner])

  const [name, setName] = useState(user?.name || '')
  const [pw, setPw] = useState({ current_password: '', new_password: '' })
  const roleLabel = isOwner ? 'Platform owner' : 'Workspace Admin'

  const saveProfile = async (e) => {
    e.preventDefault()
    try { await api.patch('/settings/me', { name: name.trim() }); toast('Profile saved') }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const changePassword = async (e) => {
    e.preventDefault()
    if (pw.new_password.length < 8) { toast('New password must be 8+ characters', 'error'); return }
    try { await api.post('/auth/change-password', pw); toast('Password changed — sign in again'); setPw({ current_password: '', new_password: '' }) }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your operator account, and platform administration" />

      <SettingsShell sections={SECTIONS} tab={tab} onTab={setTab} aliases={LEGACY_CONSOLE_TABS}>
        {tab === 'profile' && (
          <>
            <div className="card p-5 flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm"
                   style={{ background: 'linear-gradient(135deg,#111827,rgb(var(--color-brand-600)))' }}>
                <span className="text-white font-bold text-xl">{user?.name?.charAt(0)?.toUpperCase()}</span>
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold text-ink truncate">{user?.name}</p>
                <p className="text-xs text-ink-faint truncate">{user?.email}</p>
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1.5
                  ${isOwner ? 'bg-brand-500/15 text-brand-ink' : 'bg-brand-500/10 text-brand-ink'}`}>{roleLabel}</span>
              </div>
            </div>

            <form onSubmit={saveProfile} className="card p-5">
              <h2 className="text-sm font-bold text-ink mb-4">Profile</h2>
              <div className="space-y-3">
                <div><label className="label">Display name</label><input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
                <div><label className="label">Email</label><input className="input opacity-60" value={user?.email || ''} disabled /></div>
                <button className="btn-primary">Save profile</button>
              </div>
            </form>

            <form onSubmit={changePassword} className="card p-5">
              <h2 className="text-sm font-bold text-ink mb-4">Change password</h2>
              <div className="space-y-3">
                <div><label className="label">Current password</label><input type="password" className="input" value={pw.current_password} onChange={e => setPw(p => ({ ...p, current_password: e.target.value }))} /></div>
                <div><label className="label">New password</label><input type="password" className="input" value={pw.new_password} onChange={e => setPw(p => ({ ...p, new_password: e.target.value }))} placeholder="8+ characters" /></div>
                <button className="btn-primary">Change password</button>
              </div>
            </form>

            <SecurityPanel />
          </>
        )}

        {tab === 'notifications' && <NotificationPrefsPanel />}

        {tab === 'appearance' && (
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1">Appearance</h2>
            <p className="text-xs text-ink-muted mb-3">Applies to your console only.</p>
            <button onClick={toggleTheme} className="btn-secondary">
              {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            </button>
          </div>
        )}

        {tab === 'operators' && isOwner && <PlatformOperators embedded />}
      </SettingsShell>
    </div>
  )
}

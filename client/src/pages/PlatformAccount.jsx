import { useState } from 'react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

// The platform operator's own account — distinct from any label's settings.
export default function PlatformAccount() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [name, setName] = useState(user?.name || '')
  const [pw, setPw] = useState({ current_password: '', new_password: '' })

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

  const roleLabel = user?.platform_role === 'owner' ? 'Platform owner' : 'Workspace Admin'

  return (
    <div>
      <PageHeader title="Account" subtitle="Your platform operator profile" />

      <div className="card p-5 mb-6 max-w-4xl flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: 'linear-gradient(135deg,#111827,rgb(var(--color-brand-600)))' }}>
          <span className="text-white font-bold text-xl">{user?.name?.charAt(0)?.toUpperCase()}</span>
        </div>
        <div className="min-w-0">
          <p className="text-base font-bold text-ink truncate">{user?.name}</p>
          <p className="text-xs text-gray-400 truncate">{user?.email}</p>
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1.5 ${user?.platform_role === 'owner' ? 'bg-brand-500/15 text-brand-700' : 'bg-indigo-100 text-indigo-700'}`}>{roleLabel}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
        <form onSubmit={saveProfile} className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">Profile</h2>
          <div className="space-y-3">
            <div><label className="label">Display name</label><input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
            <div><label className="label">Email</label><input className="input bg-gray-50" value={user?.email || ''} disabled /></div>
            <p className="text-xs text-gray-400">Role: <span className="font-semibold text-gray-600">{roleLabel}</span></p>
            <button className="btn-primary">Save profile</button>
          </div>
        </form>

        <div className="space-y-6">
          <form onSubmit={changePassword} className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-4">Change password</h2>
            <div className="space-y-3">
              <div><label className="label">Current password</label><input type="password" className="input" value={pw.current_password} onChange={e => setPw(p => ({ ...p, current_password: e.target.value }))} /></div>
              <div><label className="label">New password</label><input type="password" className="input" value={pw.new_password} onChange={e => setPw(p => ({ ...p, new_password: e.target.value }))} placeholder="8+ characters" /></div>
              <button className="btn-primary">Change password</button>
            </div>
          </form>

          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-3">Appearance</h2>
            <button onClick={toggleTheme} className="btn-secondary">{theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

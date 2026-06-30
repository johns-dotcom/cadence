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

  return (
    <div>
      <PageHeader title="Account" subtitle="Your platform operator profile" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
        <form onSubmit={saveProfile} className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">Profile</h2>
          <div className="space-y-3">
            <div><label className="label">Display name</label><input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
            <div><label className="label">Email</label><input className="input bg-gray-50" value={user?.email || ''} disabled /></div>
            <p className="text-xs text-gray-400">Role: <span className="font-semibold text-gray-600">Platform admin</span></p>
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

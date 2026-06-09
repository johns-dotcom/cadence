import { useEffect, useState } from 'react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

export default function Settings() {
  const { user, label } = useAuth()
  const { toast } = useToast()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)

  const [name, setName] = useState(user?.name || '')
  const [labelName, setLabelName] = useState('')
  const [pw, setPw] = useState({ current_password: '', new_password: '' })

  useEffect(() => {
    if (isAdmin) api.get('/label').then(res => setLabelName(res.data.data?.name || '')).catch(() => {})
  }, [isAdmin])

  const saveProfile = async (e) => {
    e.preventDefault()
    try { await api.patch('/settings/me', { name }); toast('Profile updated') }
    catch { toast('Failed to update profile', 'error') }
  }

  const saveLabel = async (e) => {
    e.preventDefault()
    try { await api.patch('/label', { name: labelName }); toast('Workspace renamed') }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    if (pw.new_password.length < 8) { toast('New password must be 8+ characters', 'error'); return }
    try {
      await api.post('/auth/change-password', pw)
      toast('Password changed — other sessions signed out')
      setPw({ current_password: '', new_password: '' })
    } catch (err) {
      toast(err.response?.data?.error || 'Failed', 'error')
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Your profile and workspace" />

      <div className="space-y-6">
        {/* Profile */}
        <form onSubmit={saveProfile} className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">Profile</h2>
          <div className="space-y-3">
            <div><label className="label">Display name</label><input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
            <div>
              <label className="label">Email</label>
              <input className="input opacity-60" value={user?.email || ''} disabled />
            </div>
            <div className="flex gap-2 text-xs text-gray-400">
              <span>Role: <span className="font-semibold text-gray-600">{user?.role}</span></span>
              <span>·</span>
              <span>Workspace: <span className="font-semibold text-gray-600">{label?.name}</span></span>
            </div>
            <button className="btn-primary">Save profile</button>
          </div>
        </form>

        {/* Workspace (admins only) */}
        {isAdmin && (
          <form onSubmit={saveLabel} className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-4">Workspace</h2>
            <div className="space-y-3">
              <div><label className="label">Label name</label><input className="input" value={labelName} onChange={e => setLabelName(e.target.value)} /></div>
              <p className="text-xs text-gray-400">The workspace URL slug (<code className="text-gray-500">{label?.slug}</code>) is fixed so existing sign-in links keep working.</p>
              <button className="btn-primary">Save workspace</button>
            </div>
          </form>
        )}

        {/* Password */}
        <form onSubmit={changePassword} className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">Change password</h2>
          <div className="space-y-3">
            <div><label className="label">Current password</label><input type="password" className="input" value={pw.current_password} onChange={e => setPw(p => ({ ...p, current_password: e.target.value }))} /></div>
            <div><label className="label">New password</label><input type="password" className="input" value={pw.new_password} onChange={e => setPw(p => ({ ...p, new_password: e.target.value }))} placeholder="8+ characters" /></div>
            <button className="btn-primary">Change password</button>
          </div>
        </form>
      </div>
    </div>
  )
}

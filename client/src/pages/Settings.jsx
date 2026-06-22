import { useEffect, useState } from 'react'
import { Upload, Trash2, Check } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { applyAccent, resetAccent, isValidHex, ACCENT_PRESETS } from '../utils/branding'
import RepsManager from '../components/RepsManager'
import DataTools from '../components/DataTools'

export default function Settings() {
  const { user, label, updateLabel } = useAuth()
  const { toast } = useToast()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)

  const [name, setName] = useState(user?.name || '')
  const [labelName, setLabelName] = useState('')
  const [accent, setAccent] = useState(label?.accent_color || '')
  const [logoUrl, setLogoUrl] = useState(label?.logo_url || null)
  const [pw, setPw] = useState({ current_password: '', new_password: '' })

  useEffect(() => {
    if (isAdmin) api.get('/label').then(res => {
      const d = res.data.data || {}
      setLabelName(d.name || '')
      setAccent(d.accent_color || '')
      setLogoUrl(d.logo_url || null)
    }).catch(() => {})
  }, [isAdmin])

  const saveProfile = async (e) => {
    e.preventDefault()
    try { await api.patch('/settings/me', { name }); toast('Profile updated') }
    catch { toast('Failed to update profile', 'error') }
  }

  const saveLabel = async (e) => {
    e.preventDefault()
    if (accent && !isValidHex(accent)) { toast('Accent must be a hex value like #4F46E5', 'error'); return }
    try {
      const { data } = await api.patch('/label', { name: labelName, accent_color: accent || '' })
      // Re-theme immediately + keep the rest of the app in sync.
      if (accent) applyAccent(accent); else resetAccent()
      updateLabel({ name: data.data.name, accent_color: data.data.accent_color })
      toast('Workspace branding saved')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  // Live preview while picking — persist=false so it won't survive a reload
  // unless the admin clicks Save.
  const previewAccent = (hex) => { setAccent(hex); if (!hex) resetAccent(false); else if (isValidHex(hex)) applyAccent(hex, false) }

  const uploadLogo = async (file) => {
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    try {
      const { data } = await api.post('/label/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setLogoUrl(data.data.logo_url)
      updateLabel({ logo_url: data.data.logo_url })
      toast('Logo updated')
    } catch (err) { toast(err.response?.data?.error || 'Upload failed', 'error') }
  }

  const removeLogo = async () => {
    try { await api.delete('/label/logo'); setLogoUrl(null); updateLabel({ logo_url: null }); toast('Logo removed') }
    catch { toast('Failed', 'error') }
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

        {/* Workspace branding (admins only) */}
        {isAdmin && (
          <form onSubmit={saveLabel} className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1">Workspace branding</h2>
            <p className="text-xs text-gray-400 mb-4">Customize how this workspace looks for your team.</p>

            <div className="space-y-5">
              <div>
                <label className="label">Label name</label>
                <input className="input" value={labelName} onChange={e => setLabelName(e.target.value)} />
                <p className="text-xs text-gray-400 mt-1">URL slug (<code className="text-gray-500">{label?.slug}</code>) is fixed so sign-in links keep working.</p>
              </div>

              {/* Logo */}
              <div>
                <label className="label">Logo</label>
                <div className="flex items-center gap-3">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-12 h-12 rounded-lg object-cover bg-gray-100 border border-rule" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-brand-600 flex items-center justify-center">
                      <span className="text-white font-bold">{labelName?.charAt(0)?.toUpperCase() || 'C'}</span>
                    </div>
                  )}
                  <label className="btn-secondary cursor-pointer">
                    <Upload size={15} /> {logoUrl ? 'Replace' : 'Upload'}
                    <input type="file" accept="image/*" className="hidden" onChange={e => uploadLogo(e.target.files[0])} />
                  </label>
                  {logoUrl && (
                    <button type="button" onClick={removeLogo} className="text-gray-400 hover:text-danger" title="Remove logo"><Trash2 size={16} /></button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">Square image works best. Requires object storage (R2) to be configured.</p>
              </div>

              {/* Accent color */}
              <div>
                <label className="label">Accent color</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {ACCENT_PRESETS.map(p => {
                    const active = accent?.toLowerCase() === p.hex.toLowerCase()
                    return (
                      <button
                        key={p.hex}
                        type="button"
                        onClick={() => previewAccent(p.hex)}
                        title={p.name}
                        className={`w-8 h-8 rounded-full flex items-center justify-center ring-2 ring-offset-2 ring-offset-card transition ${active ? 'ring-gray-400' : 'ring-transparent hover:ring-gray-200'}`}
                        style={{ backgroundColor: p.hex }}
                      >
                        {active && <Check size={14} className="text-white" />}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={isValidHex(accent) ? accent : '#4F46E5'}
                    onChange={e => previewAccent(e.target.value)}
                    className="w-10 h-10 rounded border border-rule cursor-pointer bg-card"
                    title="Custom color"
                  />
                  <input
                    className="input w-36 font-mono"
                    value={accent}
                    onChange={e => previewAccent(e.target.value)}
                    placeholder="#4F46E5"
                  />
                  <button type="button" onClick={() => previewAccent('')} className="text-xs text-gray-500 hover:text-gray-700">Reset to default</button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Changes preview live. Click Save to apply for everyone in the workspace.</p>
              </div>

              <button className="btn-primary">Save branding</button>
            </div>
          </form>
        )}

        {/* Reps — admin only */}
        {isAdmin && <RepsManager />}

        {/* Data export / import — admin only */}
        {isAdmin && <DataTools />}

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

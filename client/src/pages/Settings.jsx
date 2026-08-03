import { useEffect, useState } from 'react'
import { Upload, Trash2, Check, Link2, Copy, RefreshCw, Plus, X, LayoutDashboard } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { applyAccent, resetAccent, isValidHex, ACCENT_PRESETS } from '../utils/branding'
import RepsManager from '../components/RepsManager'
import PermissionsManager from '../components/PermissionsManager'
import DataTools from '../components/DataTools'

// Home-dashboard widgets an owner can show/hide (all default on).
const DASH_WIDGETS = [
  { key: 'tasks', label: 'My tasks summary' },
  { key: 'bookkeeping', label: 'Bookkeeping widget (finance roles)' },
  { key: 'releases_chart', label: 'Releases-by-month chart' },
  { key: 'genre_pie', label: 'Genre-mix chart' },
  { key: 'upcoming', label: 'Upcoming releases' },
  { key: 'activity', label: 'Recent activity' },
]

export default function Settings() {
  const { user, label, updateLabel } = useAuth()
  const { toast } = useToast()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)

  const [name, setName] = useState(user?.name || '')
  const [labelName, setLabelName] = useState('')
  const [accent, setAccent] = useState(label?.accent_color || '')
  const [logoUrl, setLogoUrl] = useState(label?.logo_url || null)
  const [inv, setInv] = useState({})
  const [savingInv, setSavingInv] = useState(false)
  const [pw, setPw] = useState({ current_password: '', new_password: '' })

  // Identity + home-dashboard customization
  const [tagline, setTagline] = useState('')
  const [welcome, setWelcome] = useState('')
  const [logoInitials, setLogoInitials] = useState('')
  const [dashWidgets, setDashWidgets] = useState({})
  const [pinned, setPinned] = useState([])
  const [savingDash, setSavingDash] = useState(false)

  useEffect(() => {
    if (isAdmin) api.get('/label').then(res => {
      const d = res.data.data || {}
      setLabelName(d.name || '')
      setAccent(d.accent_color || '')
      setLogoUrl(d.logo_url || null)
      setInv(d.invoice_settings || {})
      const s = d.settings || {}
      setTagline(s.tagline || '')
      setWelcome(s.welcome || '')
      setLogoInitials(s.logo_initials || '')
      setDashWidgets(s.dashboard?.widgets || {})
      setPinned(Array.isArray(s.dashboard?.pinned) ? s.dashboard.pinned : [])
    }).catch(() => {})
  }, [isAdmin])

  const [vfCopied, setVfCopied] = useState(false)
  const vendorFormUrl = `${window.location.origin}/submit/${label?.vendor_form_token}`
  const copyVendorFormLink = () => navigator.clipboard.writeText(vendorFormUrl).then(() => { setVfCopied(true); setTimeout(() => setVfCopied(false), 2000) })
  const rotateVendorFormLink = async () => {
    if (!window.confirm('Rotate the vendor form link? The current link stops working immediately.')) return
    try { const { data } = await api.post('/label/vendor-form-token/rotate'); updateLabel({ vendor_form_token: data.data.vendor_form_token }); toast('Vendor form link rotated') }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const setInvField = (k) => (e) => setInv(s => ({ ...s, [k]: e.target.value }))
  const saveInvoiceSettings = async (e) => {
    e.preventDefault()
    setSavingInv(true)
    try { await api.patch('/label', { invoice_settings: inv }); toast('Invoice details saved') }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSavingInv(false) }
  }

  const saveProfile = async (e) => {
    e.preventDefault()
    try { await api.patch('/settings/me', { name }); toast('Profile updated') }
    catch { toast('Failed to update profile', 'error') }
  }

  const saveLabel = async (e) => {
    e.preventDefault()
    if (accent && !isValidHex(accent)) { toast('Accent must be a hex value like #4F46E5', 'error'); return }
    try {
      const settings = { tagline: tagline.trim(), welcome: welcome.trim(), logo_initials: logoInitials.trim().toUpperCase().slice(0, 3) }
      const { data } = await api.patch('/label', { name: labelName, accent_color: accent || '', settings })
      // Re-theme immediately + keep the rest of the app in sync.
      if (accent) applyAccent(accent); else resetAccent()
      updateLabel({ name: data.data.name, accent_color: data.data.accent_color, settings: data.data.settings })
      toast('Workspace identity saved')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const toggleWidget = (k) => setDashWidgets(w => ({ ...w, [k]: w[k] === false ? true : false }))
  const setPin = (i, field) => (e) => setPinned(ps => ps.map((p, idx) => idx === i ? { ...p, [field]: e.target.value } : p))
  const addPin = () => setPinned(ps => [...ps, { label: '', url: '' }])
  const removePin = (i) => setPinned(ps => ps.filter((_, idx) => idx !== i))
  const saveDashboard = async () => {
    setSavingDash(true)
    try {
      const dashboard = { widgets: dashWidgets, pinned: pinned.filter(p => p.label.trim() && p.url.trim()) }
      const { data } = await api.patch('/label', { settings: { dashboard } })
      updateLabel({ settings: data.data.settings })
      toast('Home dashboard saved')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSavingDash(false) }
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
            <h2 className="text-sm font-bold text-ink mb-1">Workspace identity &amp; branding</h2>
            <p className="text-xs text-gray-400 mb-4">Make this workspace feel like your team's own.</p>

            <div className="space-y-5">
              <div>
                <label className="label">Label name</label>
                <input className="input" value={labelName} onChange={e => setLabelName(e.target.value)} />
                <p className="text-xs text-gray-400 mt-1">URL slug (<code className="text-gray-500">{label?.slug}</code>) is fixed so sign-in links keep working.</p>
              </div>

              <div>
                <label className="label">Tagline</label>
                <input className="input" value={tagline} onChange={e => setTagline(e.target.value)} placeholder="Label Operations" maxLength={60} />
                <p className="text-xs text-gray-400 mt-1">Shown under the workspace name in the sidebar.</p>
              </div>

              <div>
                <label className="label">Dashboard welcome message</label>
                <textarea className="input min-h-[64px]" value={welcome} onChange={e => setWelcome(e.target.value)} placeholder="A note your team sees at the top of the dashboard — priorities, links, a hello." maxLength={400} />
              </div>

              {/* Logo */}
              <div>
                <label className="label">Logo</label>
                <div className="flex items-center gap-3">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-12 h-12 rounded-lg object-contain bg-gray-100 border border-rule p-0.5" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: (isValidHex(accent) ? accent : 'rgb(var(--color-brand-600))') }}>
                      <span className="text-white font-bold">{logoInitials.trim().toUpperCase() || labelName?.charAt(0)?.toUpperCase() || 'C'}</span>
                    </div>
                  )}
                  <label className="btn-secondary cursor-pointer">
                    <Upload size={15} /> {logoUrl ? 'Replace' : 'Upload'}
                    <input type="file" accept="image/*" className="hidden" onChange={e => uploadLogo(e.target.files[0])} />
                  </label>
                  {!logoUrl && (
                    <div>
                      <input value={logoInitials} onChange={e => setLogoInitials(e.target.value)} maxLength={3} placeholder={labelName?.charAt(0)?.toUpperCase() || 'AB'} className="input !w-20 text-center font-bold uppercase" />
                    </div>
                  )}
                  {logoUrl && (
                    <button type="button" onClick={removeLogo} className="text-gray-400 hover:text-danger" title="Remove logo"><Trash2 size={16} /></button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">Any shape works — a square image looks best. Keep it under 512 KB.</p>
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

              <button className="btn-primary">Save identity &amp; branding</button>
            </div>
          </form>
        )}

        {/* Home dashboard (admins only) */}
        {isAdmin && (
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><LayoutDashboard size={15} /> Home dashboard</h2>
            <p className="text-xs text-gray-400 mb-4">Choose which widgets your team sees on the dashboard, and pin quick links.</p>

            <div className="space-y-1.5 mb-5">
              {DASH_WIDGETS.map(wd => (
                <label key={wd.key} className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <span className="text-sm text-gray-700">{wd.label}</span>
                  <input type="checkbox" checked={dashWidgets[wd.key] !== false} onChange={() => toggleWidget(wd.key)} />
                </label>
              ))}
            </div>

            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Pinned links</p>
            <div className="space-y-2 mb-3">
              {pinned.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className="input !py-1.5 text-sm w-40" value={p.label} onChange={setPin(i, 'label')} placeholder="Label" />
                  <input className="input !py-1.5 text-sm flex-1" value={p.url} onChange={setPin(i, 'url')} placeholder="https://…  or  /releases" />
                  <button type="button" onClick={() => removePin(i)} className="text-gray-300 hover:text-red-600 flex-shrink-0"><X size={15} /></button>
                </div>
              ))}
              <button type="button" onClick={addPin} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"><Plus size={13} /> Add link</button>
            </div>

            <button onClick={saveDashboard} disabled={savingDash} className="btn-primary">{savingDash ? 'Saving…' : 'Save home dashboard'}</button>
          </div>
        )}

        {/* Vendor form link — public submission URL (admins only) */}
        {isAdmin && (
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><Link2 size={15} /> Vendor form link</h2>
            <p className="text-xs text-gray-400 mb-3">Share this with vendors to submit invoices — no login required. Rotating it invalidates the old link everywhere.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-[200px] text-xs bg-page border border-rule rounded-lg px-3 py-2 text-gray-600 truncate">{vendorFormUrl}</code>
              <button onClick={copyVendorFormLink} className="btn-secondary">{vfCopied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}</button>
              <button onClick={rotateVendorFormLink} className="btn-secondary"><RefreshCw size={15} /> Rotate</button>
            </div>
          </div>
        )}

        {/* Invoice details — "Funds payable to" block on issued invoices (admins only) */}
        {isAdmin && (
          <form onSubmit={saveInvoiceSettings} className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1">Invoice details</h2>
            <p className="text-xs text-gray-400 mb-4">Your company &amp; remittance info. Shown as the “Funds payable to” block on every invoice you issue.</p>
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Company</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2"><label className="label">Company legal name</label><input className="input" value={inv.company_name || ''} onChange={setInvField('company_name')} placeholder="BOOM.RECORDS LLC" /></div>
                  <div className="sm:col-span-2"><label className="label">Address</label><textarea className="input min-h-[64px]" value={inv.address || ''} onChange={setInvField('address')} placeholder={'1119 POINSETTIA DRIVE\nUNIT 01\nLOS ANGELES CA 90046-5794 USA'} /></div>
                  <div><label className="label">Contact name</label><input className="input" value={inv.contact || ''} onChange={setInvField('contact')} placeholder="JOHN SKEAD" /></div>
                  <div><label className="label">EIN / Tax ID</label><input className="input" value={inv.ein || ''} onChange={setInvField('ein')} placeholder="87-1095996" /></div>
                  <div><label className="label">Phone</label><input className="input" value={inv.phone || ''} onChange={setInvField('phone')} placeholder="201-912-3991" /></div>
                  <div><label className="label">Email</label><input className="input" value={inv.email || ''} onChange={setInvField('email')} placeholder="johns@boomrecords.co" /></div>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Bank</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="label">Bank name</label><input className="input" value={inv.bank_name || ''} onChange={setInvField('bank_name')} placeholder="BANK OF AMERICA" /></div>
                  <div><label className="label">Bank address</label><input className="input" value={inv.bank_address || ''} onChange={setInvField('bank_address')} placeholder="PO BOX 25118, TAMPA FL 33622-5118" /></div>
                  <div><label className="label">Account name</label><input className="input" value={inv.account_name || ''} onChange={setInvField('account_name')} placeholder="BOOM.RECORDS LLC" /></div>
                  <div><label className="label">Account type</label><input className="input" value={inv.account_type || ''} onChange={setInvField('account_type')} placeholder="CHECKING" /></div>
                  <div><label className="label">SWIFT</label><input className="input" value={inv.swift || ''} onChange={setInvField('swift')} placeholder="BOFAUS3N (for funds sent in USD)" /></div>
                  <div><label className="label">Routing</label><input className="input" value={inv.routing || ''} onChange={setInvField('routing')} placeholder="026009593 (WIRE) / 122000661 (ACH)" /></div>
                  <div className="sm:col-span-2"><label className="label">Account number</label><input className="input" value={inv.account_number || ''} onChange={setInvField('account_number')} placeholder="325146889268" /></div>
                </div>
              </div>
              <button disabled={savingInv} className="btn-primary">{savingInv ? 'Saving…' : 'Save invoice details'}</button>
            </div>
          </form>
        )}

        {/* Permissions — admin only */}
        {isAdmin && <PermissionsManager />}

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

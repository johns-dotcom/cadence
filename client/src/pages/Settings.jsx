import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, Eye, EyeOff, Gauge, LayoutDashboard, Link2, Mail, Moon, PanelLeft, Plus, RefreshCw, Send, ShieldCheck, Sun, Trash2, Upload, Users, X } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { navPageGroups } from '../constants/navConfig'
import { getHiddenPages, setHiddenPages, NEVER_HIDEABLE } from '../utils/navPrefs'
import { applyAccent, resetAccent, isValidHex, ACCENT_PRESETS } from '../utils/branding'
import RepsManager from '../components/RepsManager'
import VisibleRepsManager from '../components/VisibleRepsManager'
import PermissionsManager from '../components/PermissionsManager'
import RolesGuide from '../components/RolesGuide'
import DepartmentsManager from '../components/DepartmentsManager'
import DataTools from '../components/DataTools'
import SettingsShell from '../components/SettingsShell'
import LabelRecordForm from '../components/LabelRecordForm'
import { buildSettingsSections, LEGACY_TABS } from '../lib/settingsSections'
import BankAccountsManager from '../components/BankAccountsManager'
import { dropTarget } from '../utils/drop'

// Home-dashboard widgets an owner can show/hide (all default on).
const DASH_WIDGETS = [
  { key: 'tasks', label: 'My tasks card' },
  { key: 'latest_releases', label: 'Latest releases (past 14 days)' },
  { key: 'notifications', label: 'Notifications panel' },
  { key: 'bookkeeping', label: 'Bookkeeping widget (finance roles)' },
  { key: 'releases_chart', label: 'Releases-by-month chart' },
  { key: 'genre_pie', label: 'Genre-mix chart' },
  { key: 'upcoming', label: 'Upcoming releases' },
  { key: 'activity', label: 'Recent activity' },
]

// Offered as suggestions, not a closed list: the server validates against Intl,
// so any real IANA zone is accepted. Read from the runtime where the browser
// supports it, so the list cannot go stale.
const TZ_SUGGESTIONS = (() => {
  try {
    const all = Intl.supportedValuesOf?.('timeZone')
    if (all?.length) return all
  } catch { /* older browser */ }
  return ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
    'Europe/London', 'Europe/Berlin', 'Europe/Stockholm', 'Australia/Sydney', 'Asia/Tokyo', 'UTC']
})()

export default function Settings() {
  const { user, label, updateLabel, canView } = useAuth()
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)
  const [tab, setTab] = useState('profile')

  // Memoised: the shell watches this list, and a fresh array every render
  // would re-run its URL-sync effect on every keystroke in any panel.
  const SECTIONS = useMemo(() => buildSettingsSections(isAdmin), [isAdmin])

  const [name, setName] = useState(user?.name || '')
  const [labelName, setLabelName] = useState('')
  const [accent, setAccent] = useState(label?.accent_color || '')
  const [logoUrl, setLogoUrl] = useState(label?.logo_url || null)
  const [pw, setPw] = useState({ current_password: '', new_password: '' })

  // Identity + home-dashboard customization
  const [tagline, setTagline] = useState('')
  const [welcome, setWelcome] = useState('')
  const [logoInitials, setLogoInitials] = useState('')
  const [dashWidgets, setDashWidgets] = useState({})
  const [pinned, setPinned] = useState([])
  const [savingDash, setSavingDash] = useState(false)

  // Outbound email identity
  const [replyTo, setReplyTo] = useState('')
  const [fromName, setFromName] = useState('')
  const [fromAddr, setFromAddr] = useState('')
  const [verifiedFor, setVerifiedFor] = useState('')
  const [verifying, setVerifying] = useState(false)
  // Named by the server (EMAIL_FROM), never hardcoded here — a copy in the
  // client would go stale the first time that env var changes.
  const [platformSender, setPlatformSender] = useState('the Cadence address')
  // The workspace's business calendar. It anchors invoice due dates AND the
  // Mon–Sun week boundaries on Payments' analytics — one setting, because two
  // would let the two disagree (see server/lib/labelTz.js).
  const [bizTz, setBizTz] = useState('')
  const [savingTz, setSavingTz] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)
  const [taskCapacity, setTaskCapacity] = useState('10')
  const [savingCapacity, setSavingCapacity] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (isAdmin) api.get('/label').then(res => {
      const d = res.data.data || {}
      setLabelName(d.name || '')
      setAccent(d.accent_color || '')
      setLogoUrl(d.logo_url || null)
      if (d.platform_from_address) setPlatformSender(d.platform_from_address)
      const s = d.settings || {}
      setBizTz(s.business_tz || '')
      setTagline(s.tagline || '')
      setWelcome(s.welcome || '')
      setLogoInitials(s.logo_initials || '')
      setDashWidgets(s.dashboard?.widgets || {})
      setPinned(Array.isArray(s.dashboard?.pinned) ? s.dashboard.pinned : [])
      setReplyTo(s.email_reply_to || '')
      setFromName(s.email_from_name || '')
      setFromAddr(s.email_from_address || '')
      // The address the stamp was earned BY — not merely that a stamp exists.
      setVerifiedFor(s.email_from_verified_at ? (s.email_from_verified_for || '') : '')
      setTaskCapacity(String(s.task_capacity || 10))
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

  const saveEmail = async (e) => {
    e.preventDefault()
    const rt = replyTo.trim()
    if (rt && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rt)) { toast('Reply-to must be a valid email address', 'error'); return }
    setSavingEmail(true)
    try {
      const { data } = await api.patch('/label', {
        settings: { email_reply_to: rt, email_from_name: fromName.trim(), email_from_address: fromAddr.trim() },
      })
      updateLabel({ settings: data.data.settings })
      setVerifiedFor(data.data.settings?.email_from_verified_at ? (data.data.settings.email_from_verified_for || '') : '')
      toast('Email settings saved')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSavingEmail(false) }
  }
  // Verification is a real send FROM the address. Nothing else proves the
  // provider will accept it, and until it does we keep sending from Cadence so
  // a half-configured domain cannot silently stop this workspace's email.
  const verifySender = async () => {
    const addr = fromAddr.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { toast('Enter a valid send-from address first', 'error'); return }
    setVerifying(true)
    try {
      const { data } = await api.post('/label/email-sender/verify', { from_address: addr, from_name: fromName.trim() })
      updateLabel({ settings: data.data.settings })
      setVerifiedFor(data.data.settings?.email_from_verified_for || addr)
      toast(`Verified — sent from ${addr} to ${data.data.sent_to}`)
    } catch (err) {
      const d = err.response?.data
      toast([d?.error, d?.hint].filter(Boolean).join(' — ') || 'Could not verify that address', 'error')
    } finally { setVerifying(false) }
  }

  const saveTz = async (e) => {
    e.preventDefault()
    setSavingTz(true)
    try {
      const { data } = await api.patch('/label', { settings: { business_tz: bizTz.trim() } })
      updateLabel({ settings: data.data.settings })
      toast('Business timezone saved')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSavingTz(false) }
  }

  const sendTestEmail = async () => {
    setTesting(true)
    try { const { data } = await api.post('/label/test-email'); toast(`Test email sent to ${data.data.to}`) }
    catch (err) { toast(err.response?.data?.error || 'Failed to send — check your email provider is configured', 'error') }
    finally { setTesting(false) }
  }

  // Target open-task count per person, powering the Team Work workload bars. Saved
  // as its own settings sub-section — PATCH /api/label shallow-merges `settings`, so
  // each section writes independently.
  const saveCapacity = async (e) => {
    e.preventDefault()
    const n = parseInt(taskCapacity, 10)
    if (!Number.isInteger(n) || n < 1 || n > 200) { toast('Enter a number between 1 and 200', 'error'); return }
    setSavingCapacity(true)
    try {
      const { data } = await api.patch('/label', { settings: { task_capacity: n } })
      updateLabel({ settings: data.data.settings })
      toast('Workload target saved')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSavingCapacity(false) }
  }

  // Addresses compare case-insensitively — the server's rule, mirrored, so the
  // badge cannot disagree with what actually sends.
  const sameAddr = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

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

  // ── Sidebar (My Nav) ──────────────────────────────────────────────────────
  // A per-person view preference, NOT a permission: everything hidden here is
  // still reachable by URL, by ⌘K and by every link in the app. It reads the
  // SAME buildNavGroups the sidebar renders, so the list can't offer a toggle
  // for a row that isn't there.
  const [hidden, setHidden] = useState(() => getHiddenPages(user?.id))
  useEffect(() => { setHidden(getHiddenPages(user?.id)) }, [user?.id])
  // navPageGroups, not buildNavGroups: the sidebar's tab families and
  // sub-groups are single ROWS there, but each of their children is a page you
  // can hide on its own, so this list has to see them flattened.
  const navGroups = navPageGroups({ isAdmin, isApprover })
    .map(g => ({ ...g, items: g.items.filter(i => canView(i.path) && !NEVER_HIDEABLE.includes(i.path)) }))
    .filter(g => g.items.length > 0)
  const navTotal = navGroups.reduce((n, g) => n + g.items.length, 0)
  const navShown = navTotal - navGroups.reduce((n, g) => n + g.items.filter(i => hidden.includes(i.path)).length, 0)
  const toggleNav = (path) => setHidden(h => setHiddenPages(user?.id, h.includes(path) ? h.filter(p => p !== path) : [...h, path]))
  const showAllNav = () => setHidden(setHiddenPages(user?.id, []))

  // ThemeContext.setTheme both applies and persists (PATCH /settings/theme), so
  // a new device opens in the theme this person chose instead of resetting to
  // light. Calling the endpoint again here would just double the write.
  const chooseTheme = (t) => setTheme(t)

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
    <div>
      <PageHeader title="Settings" subtitle="Your preferences, and how this workspace is set up" />

      <SettingsShell sections={SECTIONS} tab={tab} onTab={setTab} aliases={LEGACY_TABS}>
        {/* ── My settings · Profile ── */}
        {tab === 'profile' && (<>
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
        </>)}

        {/* ── My settings · Sign-in ── */}
        {tab === 'signin' && (<>
        <form onSubmit={changePassword} className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">Change password</h2>
          <div className="space-y-3">
            <div><label className="label">Current password</label><input type="password" className="input" value={pw.current_password} onChange={e => setPw(p => ({ ...p, current_password: e.target.value }))} /></div>
            <div><label className="label">New password</label><input type="password" className="input" value={pw.new_password} onChange={e => setPw(p => ({ ...p, new_password: e.target.value }))} placeholder="8+ characters" /></div>
            <button className="btn-primary">Change password</button>
          </div>
        </form>
        </>)}

        {/* ── My settings · Appearance ── */}
        {tab === 'appearance' && (<>
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-1">Appearance</h2>
          <p className="text-xs text-ink-muted mb-4">Applies to your account on every device you sign in from.</p>
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            {[
              { key: 'light', label: 'Light', icon: Sun },
              { key: 'dark', label: 'Dark', icon: Moon },
            ].map(t => {
              const Icon = t.icon
              const active = theme === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => chooseTheme(t.key)}
                  aria-pressed={active}
                  className={`rounded-xl border p-4 text-left transition ${active ? 'border-brand-600 bg-brand-500/10' : 'border-rule hover:border-gray-300'}`}
                >
                  <Icon size={18} className={active ? 'text-brand-ink' : 'text-ink-muted'} />
                  <p className="mt-2 text-sm font-semibold text-ink">{t.label}</p>
                  {active && <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-bold text-brand-ink"><Check size={11} /> Active</span>}
                </button>
              )
            })}
          </div>
        </div>

        </>)}

        {/* ── My settings · My navigation ── */}
        {tab === 'nav' && (<>
        <div className="card p-5">
          <div className="flex flex-wrap items-baseline gap-2 mb-1">
            <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><PanelLeft size={15} /> Sidebar</h2>
            <span className="text-xs text-ink-muted">{navShown} of {navTotal} items shown</span>
            {hidden.length > 0 && (
              <button type="button" onClick={showAllNav} className="ml-auto text-xs font-semibold text-brand-ink hover:underline">Show all</button>
            )}
          </div>
          <p className="text-xs text-ink-muted mb-4">
            Hide items you never use. This only tidies <em>your</em> sidebar — hidden pages stay open to you by link,
            by search and from anywhere else in the app, and nobody else's view changes.
          </p>
          <div className="space-y-4">
            {navGroups.map(g => (
              <div key={g.label || 'general'}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-1.5">{g.label || 'General'}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                  {g.items.map(i => {
                    const isHidden = hidden.includes(i.path)
                    return (
                      <button
                        key={i.path}
                        type="button"
                        onClick={() => toggleNav(i.path)}
                        aria-pressed={!isHidden}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-brand-500/10"
                      >
                        {isHidden ? <EyeOff size={14} className="text-ink-faint flex-shrink-0" /> : <Eye size={14} className="text-brand-ink flex-shrink-0" />}
                        <span className={`text-sm truncate ${isHidden ? 'text-ink-faint line-through' : 'text-ink'}`}>{i.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        </>)}

        {/* ── Workspace ── */}
        {/* ── Label settings · Identity & branding ── */}
        {tab === 'branding' && isAdmin && (<>
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
                  <label className="btn-secondary cursor-pointer" {...dropTarget(uploadLogo)}>
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

          {/* Home dashboard */}
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
        </>)}

        {/* ── Finance ── */}
        {/* ── Label settings · Email & forms ── */}
        {tab === 'email' && isAdmin && (<>
          {/* Outbound email identity */}
          <form onSubmit={saveEmail} className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><Mail size={15} /> Outbound email</h2>
            <p className="text-xs text-gray-400 mb-4">Every email this workspace sends — invites, vendor decisions, payment confirmations, task assignments, mention alerts — goes out with this identity and your accent color.</p>
            <div className="max-w-md space-y-4">
              <div>
                <label className="label">Sender name</label>
                <input className="input" value={fromName} onChange={e => setFromName(e.target.value)}
                  placeholder={`${labelName || 'Your workspace'} via Cadence`} maxLength={80} />
                <p className="text-[11px] text-gray-400 mt-1">What recipients see as the sender. Safe to change at any time.</p>
              </div>
              <div>
                <label className="label">Send from</label>
                <input className="input" type="email" value={fromAddr} onChange={e => setFromAddr(e.target.value)}
                  placeholder={platformSender} />
                <div className="mt-1.5 text-[11px]">
                  {!fromAddr.trim() ? (
                    <span className="text-gray-400">Blank sends from <span className="font-medium text-ink">{platformSender}</span>.</span>
                  ) : sameAddr(fromAddr, verifiedFor) ? (
                    <span className="text-success font-semibold inline-flex items-center gap-1">
                      <Check size={12} /> Verified — your email sends from this address.
                    </span>
                  ) : (
                    <span className="text-warning">
                      Not verified yet, so mail still goes out from <span className="font-medium text-ink">{platformSender}</span>.
                      Your email provider must be set up to send for this domain — press Verify to prove it with a real send.
                    </span>
                  )}
                </div>
              </div>
              <div>
                <label className="label">Reply-to address</label>
                <input className="input" type="email" value={replyTo} onChange={e => setReplyTo(e.target.value)} placeholder="billing@yourlabel.com" />
                <p className="text-[11px] text-gray-400 mt-1">Where replies land. Leave blank to use the default Cadence reply address.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <button type="submit" disabled={savingEmail} className="btn-primary">{savingEmail ? 'Saving…' : 'Save email settings'}</button>
              {fromAddr.trim() && !sameAddr(fromAddr, verifiedFor) && (
                <button type="button" onClick={verifySender} disabled={verifying} className="btn-secondary">
                  <ShieldCheck size={15} /> {verifying ? 'Verifying…' : 'Verify this address'}
                </button>
              )}
              <button type="button" onClick={sendTestEmail} disabled={testing} className="btn-secondary"><Send size={15} /> {testing ? 'Sending…' : 'Send test to me'}</button>
            </div>
          </form>

          <form onSubmit={saveTz} className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><Gauge size={15} /> Business timezone</h2>
            <p className="text-xs text-gray-400 mb-4">
              The calendar this workspace runs on. Invoice due dates are printed in it, and the
              week boundaries on Payments' analytics are anchored to it — so a Sunday-evening
              entry lands in the week you filed it, not the next one.
            </p>
            <div className="max-w-md">
              <label className="label">Timezone</label>
              <input className="input" list="tz-options" value={bizTz} onChange={e => setBizTz(e.target.value)}
                placeholder="America/Los_Angeles" />
              <datalist id="tz-options">
                {TZ_SUGGESTIONS.map(t => <option key={t} value={t} />)}
              </datalist>
              <p className="text-[11px] text-gray-400 mt-1">
                An IANA name. Leave blank for the default, America/Los_Angeles.
              </p>
            </div>
            <button type="submit" disabled={savingTz} className="btn-primary mt-4">{savingTz ? 'Saving…' : 'Save timezone'}</button>
          </form>

          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><Link2 size={15} /> Vendor form link</h2>
            <p className="text-xs text-gray-400 mb-3">Share this with vendors to submit invoices — no login required. Rotating it invalidates the old link everywhere.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-[200px] text-xs bg-page border border-rule rounded-lg px-3 py-2 text-gray-600 truncate">{vendorFormUrl}</code>
              <button onClick={copyVendorFormLink} className="btn-secondary">{vfCopied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}</button>
              <button onClick={rotateVendorFormLink} className="btn-secondary"><RefreshCw size={15} /> Rotate</button>
            </div>
          </div>

        </>)}

        {/* ── Label settings · Label record ── */}
        {tab === 'label' && isAdmin && (<>
          <LabelRecordForm />

          {/* Feeds lib/bankEvidence.js — see the component for why this is not cosmetic. */}
          <BankAccountsManager />
        </>)}

        {/* ── Label settings · People ── */}
        {tab === 'people' && isAdmin && (<>
          {/* The roster itself is a page, not a panel — it has per-person
              detail, workload and an Access tab that no settings card could
              hold. This points at it rather than reproducing a worse copy. */}
          <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="min-w-0">
              <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-ink">
                <Users size={15} /> The people directory
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                Add and remove members, set roles and departments, resend invites — and open anyone to edit
                the pages they can see.
              </p>
            </div>
            <Link to="/team" className="btn-secondary whitespace-nowrap">Open directory</Link>
          </div>

          <form onSubmit={saveCapacity} className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><Gauge size={15} /> Workload target</h2>
            <p className="text-xs text-ink-muted mb-4">
              How many open tasks one person is expected to carry. The load bars on{' '}
              <Link to="/my-work?tab=team" className="text-brand-ink hover:underline font-medium">Team Work</Link>{' '}
              fill against this, so anyone above it reads as over capacity.
            </p>
            <div className="max-w-[10rem]">
              <label className="label" htmlFor="task-capacity">Open tasks per person</label>
              <input
                id="task-capacity"
                className="input"
                type="number"
                min={1}
                max={200}
                value={taskCapacity}
                onChange={e => setTaskCapacity(e.target.value)}
              />
            </div>
            <button type="submit" disabled={savingCapacity} className="btn-primary mt-4">
              {savingCapacity ? 'Saving…' : 'Save workload target'}
            </button>
          </form>
          <RepsManager />
          {/* After RepsManager: you pick reps for a member FROM the roster it manages,
              so the roster has to be the thing above it. */}
          <VisibleRepsManager />
        </>)}

        {/* ── Label settings · Roles & access ── */}
        {tab === 'roles' && isAdmin && (<>
          {/* Reference first, tools after — the guide answers the questions the
              editor below it provokes (why ticking pages for an Admin does
              nothing, why moving somebody to Finance granted them nothing).
              Collapsed by default so it costs the people who already know it
              one line. */}
          <RolesGuide />
          {/* The workspace-wide matrix. One person's pages are also editable on
              their own page (/team/:id → Access), which is where you land coming
              from the directory; this is the view for "who has what" across
              everybody. Both mount the same component and write the same
              endpoint — see components/PermissionsManager.jsx. */}
          <PermissionsManager />
          {/* Below the permissions editor, because a department's only job here
              is seeding the preset that editor applies. */}
          <DepartmentsManager />
        </>)}

        {/* ── Data ── */}
        {/* ── Label settings · Data ── */}
        {tab === 'data' && isAdmin && <DataTools />}
      </SettingsShell>
    </div>
  )
}

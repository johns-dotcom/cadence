import { useEffect, useRef, useState } from 'react'
import {
  X, LogIn, Users, Music, Disc3, TrendingUp, FileText, BookOpen, Receipt,
  CheckSquare, Clock, Upload, Trash2, KeyRound, Ban, RotateCcw, Copy, Check, Palette,
} from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { ACCENT_PRESETS, isValidHex } from '../utils/branding'

const fmtAgo = (d) => {
  if (!d) return 'never'
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`
  return new Date(d).toLocaleDateString()
}

const STAT_DEFS = [
  { key: 'artists', label: 'Artists', icon: Disc3 },
  { key: 'releases', label: 'Releases', icon: Music },
  { key: 'deals', label: 'Deals', icon: TrendingUp },
  { key: 'contracts', label: 'Contracts', icon: FileText },
  { key: 'ledger_entries', label: 'Ledger', icon: BookOpen },
  { key: 'invoices', label: 'Invoices', icon: Receipt },
  { key: 'pending_approvals', label: 'Pending', icon: Clock },
  { key: 'open_tasks', label: 'Open tasks', icon: CheckSquare },
]

export default function WorkspaceDrawer({ workspaceId, isOwner = true, onClose, onEnter, onChanged }) {
  const { toast } = useToast()
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const logoRef = useRef(null)

  // Manage-tab form state
  const [name, setName] = useState('')
  const [accent, setAccent] = useState('')
  const [resetPw, setResetPw] = useState('')
  const [handoff, setHandoff] = useState(null)
  const [copied, setCopied] = useState(false)
  const [confirmName, setConfirmName] = useState('')

  const load = () => {
    setLoading(true)
    api.get(`/platform/workspaces/${workspaceId}`)
      .then(r => { setData(r.data.data); setName(r.data.data.label.name); setAccent(r.data.data.label.accent_color || '') })
      .catch(() => toast('Failed to load workspace', 'error'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [workspaceId])

  const saveBranding = async () => {
    try { await api.patch(`/platform/workspaces/${workspaceId}`, { name: name.trim(), accent_color: accent || null }); toast('Saved'); load(); onChanged?.() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const uploadLogo = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const fd = new FormData(); fd.append('logo', file)
    try { await api.post(`/platform/workspaces/${workspaceId}/logo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); toast('Logo updated'); load(); onChanged?.() }
    catch { toast('Upload failed', 'error') } finally { e.target.value = '' }
  }
  const removeLogo = async () => { try { await api.delete(`/platform/workspaces/${workspaceId}/logo`); load(); onChanged?.() } catch { toast('Failed', 'error') } }
  const resetOwner = async () => {
    if (resetPw.length < 8) { toast('Password must be 8+ characters', 'error'); return }
    try { const { data: d } = await api.post(`/platform/workspaces/${workspaceId}/reset-owner`, { password: resetPw }); setHandoff(d.data); setResetPw(''); toast('Owner password reset') }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const copyHandoff = () => {
    if (!handoff) return
    navigator.clipboard.writeText(`Workspace: ${handoff.label.name}\nSign-in email: ${handoff.owner.email}\nTemporary password: ${handoff.password}\nWorkspace ID: ${handoff.label.slug}`)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  const toggleSuspend = async () => {
    const suspended = data.label.status === 'suspended'
    if (!window.confirm(suspended ? 'Reactivate this workspace?' : 'Suspend this workspace? All its users will be locked out.')) return
    try { await api.post(`/platform/workspaces/${workspaceId}/${suspended ? 'reactivate' : 'suspend'}`); toast(suspended ? 'Reactivated' : 'Suspended'); load(); onChanged?.() }
    catch { toast('Failed', 'error') }
  }
  const del = async () => {
    try { await api.delete(`/platform/workspaces/${workspaceId}`, { data: { confirm: confirmName } }); toast('Workspace deleted'); onChanged?.(); onClose() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'members', label: 'Members' },
    { key: 'activity', label: 'Activity' },
    ...(isOwner ? [{ key: 'manage', label: 'Manage' }] : []),
  ]
  const suspended = data?.label?.status === 'suspended'

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-overlay" onClick={onClose}>
      <div className="w-full max-w-lg bg-card h-full shadow-modal flex flex-col" onClick={e => e.stopPropagation()}>
        {loading || !data ? (
          <div className="flex-1 flex items-center justify-center"><p className="text-sm text-gray-400">Loading…</p></div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start gap-3 px-5 py-4 border-b border-divider">
              {data.label.logo_url ? (
                <img src={data.label.logo_url} alt="" className="w-12 h-12 rounded-xl object-cover bg-gray-100 flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: data.label.accent_color || '#4F46E5' }}>
                  <span className="text-white font-bold text-lg">{data.label.name?.charAt(0)?.toUpperCase()}</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-ink truncate">{data.label.name}</h2>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${suspended ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{suspended ? 'Suspended' : 'Active'}</span>
                </div>
                <p className="text-xs text-gray-400 font-mono">{data.label.slug}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {data.owner ? `Owner: ${data.owner.name} · ${data.owner.email}` : 'No owner'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => onEnter(data.label)} className="btn-primary !py-1.5 text-xs"><LogIn size={13} /> Enter</button>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-4 py-2 border-b border-divider">
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${tab === t.key ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:bg-gray-50'}`}>{t.label}</button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {tab === 'overview' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="card p-3"><div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><Users size={13} /> Members</div><p className="text-lg font-bold text-ink">{data.membersByRole && Object.values(data.membersByRole).reduce((a, b) => a + b, 0)}</p></div>
                    <div className="card p-3"><div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><Clock size={13} /> Last active</div><p className="text-sm font-semibold text-ink">{fmtAgo(data.recentActivity[0]?.created_at)}</p></div>
                    {STAT_DEFS.map(s => {
                      const Icon = s.icon
                      return (
                        <div key={s.key} className="card p-3">
                          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><Icon size={13} /> {s.label}</div>
                          <p className="text-lg font-bold text-ink">{data.counts[s.key] ?? 0}</p>
                        </div>
                      )
                    })}
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Members by role</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(data.membersByRole).length ? Object.entries(data.membersByRole).map(([r, n]) => (
                        <span key={r} className="text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">{r}: <span className="font-semibold">{n}</span></span>
                      )) : <span className="text-sm text-gray-400">No members.</span>}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400">Created {new Date(data.label.created_at).toLocaleDateString()} · Last login {fmtAgo(data.lastLogin)}</p>
                </div>
              )}

              {tab === 'members' && (
                <div className="space-y-1.5">
                  {data.members.length ? data.members.map(m => (
                    <div key={m.id} className="flex items-center gap-3 py-2 border-b border-divider last:border-0">
                      <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0"><span className="text-xs font-bold text-brand-700">{m.name?.charAt(0)?.toUpperCase()}</span></div>
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium text-ink truncate">{m.name}</p><p className="text-[11px] text-gray-400 truncate">{m.email}</p></div>
                      <span className="text-[10px] font-semibold text-gray-500 uppercase">{m.role}</span>
                    </div>
                  )) : <p className="text-sm text-gray-400">No members.</p>}
                </div>
              )}

              {tab === 'activity' && (
                <div className="space-y-2">
                  {data.recentActivity.length ? data.recentActivity.map((a, i) => (
                    <div key={i} className="border-b border-divider last:border-0 pb-2">
                      <p className="text-sm text-ink">{a.action}{a.detail ? <span className="text-gray-400"> — {a.detail}</span> : ''}</p>
                      <p className="text-[11px] text-gray-400">{a.user_name || 'System'} · {fmtAgo(a.created_at)}</p>
                    </div>
                  )) : <p className="text-sm text-gray-400">No activity yet.</p>}
                </div>
              )}

              {tab === 'manage' && (
                <div className="space-y-6">
                  {/* Rename + branding */}
                  <div>
                    <h3 className="text-sm font-bold text-ink mb-2 flex items-center gap-1.5"><Palette size={14} /> Branding</h3>
                    <label className="label">Workspace name</label>
                    <input className="input mb-2" value={name} onChange={e => setName(e.target.value)} />
                    <label className="label">Accent color</label>
                    <div className="flex items-center gap-2 mb-2">
                      <input className="input !w-32 font-mono" value={accent} onChange={e => setAccent(e.target.value)} placeholder="#4F46E5" />
                      <div className="flex gap-1">
                        {ACCENT_PRESETS.slice(0, 6).map(p => (
                          <button key={p.hex} onClick={() => setAccent(p.hex)} className="w-6 h-6 rounded-full border border-rule" style={{ background: p.hex }} title={p.name} />
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => logoRef.current?.click()} className="btn-secondary !py-1.5 text-xs"><Upload size={13} /> {data.label.logo_url ? 'Replace logo' : 'Upload logo'}</button>
                      {data.label.logo_url && <button onClick={removeLogo} className="text-xs text-gray-400 hover:text-red-600">Remove</button>}
                      <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
                      <button onClick={saveBranding} disabled={accent && !isValidHex(accent)} className="btn-primary !py-1.5 text-xs ml-auto">Save</button>
                    </div>
                  </div>

                  {/* Reset owner */}
                  <div>
                    <h3 className="text-sm font-bold text-ink mb-2 flex items-center gap-1.5"><KeyRound size={14} /> Reset owner credentials</h3>
                    <p className="text-xs text-gray-400 mb-2">Sets a new temporary password for {data.owner?.email || 'the owner'} and signs them out everywhere.</p>
                    <div className="flex gap-2">
                      <input className="input" type="text" value={resetPw} onChange={e => setResetPw(e.target.value)} placeholder="New temporary password (8+)" />
                      <button onClick={resetOwner} className="btn-secondary !py-1.5 text-xs flex-shrink-0">Reset</button>
                    </div>
                    {handoff && (
                      <div className="mt-2 card p-3 bg-brand-50/40 border-brand-200">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs space-y-0.5">
                            <p>Email: <span className="font-medium">{handoff.owner.email}</span></p>
                            <p>Temp password: <span className="font-mono">{handoff.password}</span></p>
                            <p>Workspace ID: <span className="font-mono">{handoff.label.slug}</span></p>
                          </div>
                          <button onClick={copyHandoff} className="btn-secondary !py-1 text-[11px] flex-shrink-0">{copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Danger zone */}
                  <div className="border border-red-200 rounded-xl p-4 bg-red-50/30">
                    <h3 className="text-sm font-bold text-red-700 mb-3">Danger zone</h3>
                    <button onClick={toggleSuspend} className="w-full mb-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50">
                      {suspended ? <><RotateCcw size={13} /> Reactivate workspace</> : <><Ban size={13} /> Suspend workspace</>}
                    </button>
                    <p className="text-xs text-gray-500 mb-1.5">Type <span className="font-mono font-semibold">{data.label.name}</span> to permanently delete this workspace and all its data.</p>
                    <div className="flex gap-2">
                      <input className="input" value={confirmName} onChange={e => setConfirmName(e.target.value)} placeholder="Workspace name" />
                      <button onClick={del} disabled={confirmName.trim() !== data.label.name} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-red-600 text-white disabled:opacity-40 flex-shrink-0"><Trash2 size={13} /> Delete</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import {
  X, LogIn, Users, Music, Disc3, TrendingUp, FileText, BookOpen, Receipt,
  CheckSquare, Clock, Upload, Trash2, KeyRound, Ban, RotateCcw, Copy, Check, Palette,
  UserPlus, Crown, CreditCard,
} from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { ACCENT_PRESETS, isValidHex } from '../utils/branding'
import { PLANS, PLAN, BILLING_STATUSES, money } from '../constants/plans'

const MEMBER_ROLES = ['Superadmin', 'Admin', 'Approver', 'User']

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

  // Members-tab state
  const [showInvite, setShowInvite] = useState(false)
  const [invite, setInvite] = useState({ name: '', email: '', role: 'User' })
  const [inviteResult, setInviteResult] = useState(null)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)

  // Billing form state
  const [billing, setBilling] = useState({ plan: 'free', billing_status: 'active', mrr_override: '' })
  const [billingSaving, setBillingSaving] = useState(false)

  // Console operators (for assigning one as workspace owner) — owner-only.
  const [operators, setOperators] = useState([])
  const [opOwnerId, setOpOwnerId] = useState('')
  useEffect(() => {
    if (!isOwner) return
    api.get('/platform/operators').then(r => setOperators(r.data.data || [])).catch(() => {})
  }, [isOwner])

  const load = () => {
    setLoading(true)
    api.get(`/platform/workspaces/${workspaceId}`)
      .then(r => {
        const d = r.data.data
        setData(d); setName(d.label.name); setAccent(d.label.accent_color || '')
        setBilling({ plan: d.label.plan || 'free', billing_status: d.label.billing_status || 'active', mrr_override: d.label.mrr_override ?? '' })
      })
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

  // ── Member & owner management ──
  const inviteMember = async () => {
    if (!invite.name.trim() || !invite.email.trim()) { toast('Name and email are required', 'error'); return }
    setInviteBusy(true)
    try {
      const { data: d } = await api.post(`/platform/workspaces/${workspaceId}/members`, invite)
      setInviteResult(d.data)
      setInvite({ name: '', email: '', role: 'User' })
      toast(d.data.email_sent ? 'Invite emailed' : 'Member added — share the invite link')
      load(); onChanged?.()
    } catch (err) { toast(err.response?.data?.error || 'Failed to invite', 'error') }
    finally { setInviteBusy(false) }
  }
  const changeRole = async (m, role) => {
    try { await api.patch(`/platform/workspaces/${workspaceId}/members/${m.id}`, { role }); toast('Role updated'); load(); onChanged?.() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const makeOwner = async (m) => {
    if (!window.confirm(`Make ${m.name} the owner of this workspace? The current owner becomes an Admin.`)) return
    try { await api.post(`/platform/workspaces/${workspaceId}/members/${m.id}/make-owner`); toast(`${m.name} is now the owner`); load(); onChanged?.() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const removeMember = async (m) => {
    if (!window.confirm(`Remove ${m.name} from this workspace? This permanently deletes their account and reassigns their records.`)) return
    try { await api.delete(`/platform/workspaces/${workspaceId}/members/${m.id}`); toast('Member removed'); load(); onChanged?.() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const copyInvite = () => {
    if (!inviteResult) return
    navigator.clipboard.writeText(inviteResult.invite_link).then(() => { setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2000) })
  }
  const setOperatorOwner = async (operatorId) => {
    try {
      await api.post(`/platform/workspaces/${workspaceId}/owner`, { operator_id: operatorId })
      toast(operatorId ? 'Operator set as workspace owner' : 'Reverted to member owner')
      setOpOwnerId(''); load(); onChanged?.()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const saveBilling = async () => {
    setBillingSaving(true)
    try {
      await api.post(`/platform/workspaces/${workspaceId}/plan`, {
        plan: billing.plan, billing_status: billing.billing_status,
        mrr_override: billing.mrr_override === '' ? null : billing.mrr_override,
      })
      toast('Plan updated'); load(); onChanged?.()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBillingSaving(false) }
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
                  {data.label.plan && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{PLAN[data.label.plan]?.name || data.label.plan}</span>}
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
                <div className="space-y-4">
                  {/* Workspace owner — assign a console operator (owner-only) */}
                  {isOwner && (
                    <div className="card p-3">
                      <div className="flex items-center gap-1.5 mb-1.5"><Crown size={14} className="text-amber-500" /><h3 className="text-sm font-bold text-ink">Workspace owner</h3></div>
                      <p className="text-xs text-gray-500 mb-2">
                        {data.owner
                          ? <>Currently <span className="font-medium text-ink">{data.owner.name}</span>{data.owner.is_platform_admin ? <span className="text-[10px] font-semibold bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded ml-1">Operator</span> : ` · ${data.owner.email}`}</>
                          : 'No owner set.'}
                      </p>
                      <div className="flex items-center gap-2">
                        <select value={opOwnerId} onChange={e => setOpOwnerId(e.target.value)} className="input !py-1.5 text-sm">
                          <option value="">Assign a console operator…</option>
                          {operators.map(op => <option key={op.id} value={op.id}>{op.name}{op.platform_role === 'owner' ? ' (owner)' : ''} · {op.email}</option>)}
                        </select>
                        <button onClick={() => opOwnerId && setOperatorOwner(Number(opOwnerId))} disabled={!opOwnerId} className="btn-primary !py-1.5 text-xs flex-shrink-0">Set</button>
                      </div>
                      {data.label.owner_user_id && <button onClick={() => setOperatorOwner(null)} className="text-[11px] text-gray-400 hover:text-gray-600 mt-1.5">Clear operator owner (revert to a member)</button>}
                    </div>
                  )}

                  {/* Invite */}
                  <div>
                    {!showInvite ? (
                      <button onClick={() => { setShowInvite(true); setInviteResult(null) }} className="btn-secondary !py-1.5 text-xs"><UserPlus size={13} /> Invite member</button>
                    ) : (
                      <div className="card p-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input className="input !py-1.5 text-sm" placeholder="Name" value={invite.name} onChange={e => setInvite(v => ({ ...v, name: e.target.value }))} />
                          <select className="input !py-1.5 text-sm" value={invite.role} onChange={e => setInvite(v => ({ ...v, role: e.target.value }))}>
                            {MEMBER_ROLES.map(r => <option key={r} value={r}>{r === 'Superadmin' ? 'Superadmin (owner)' : r}</option>)}
                          </select>
                          <input className="input !py-1.5 text-sm col-span-2" placeholder="Email" value={invite.email} onChange={e => setInvite(v => ({ ...v, email: e.target.value }))} />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => { setShowInvite(false); setInviteResult(null) }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                          <button onClick={inviteMember} disabled={inviteBusy} className="btn-primary !py-1.5 text-xs">{inviteBusy ? 'Sending…' : 'Send invite'}</button>
                        </div>
                        {inviteResult && (
                          <div className="card p-2.5 bg-brand-50/40 border-brand-200 flex items-start justify-between gap-2">
                            <div className="text-[11px] min-w-0">
                              <p className="font-medium text-ink">{inviteResult.user.email}</p>
                              <p className="text-gray-500 truncate">{inviteResult.email_sent ? 'Invite emailed.' : 'Email not configured — share this link:'} </p>
                              {!inviteResult.email_sent && <p className="font-mono text-[10px] text-gray-500 truncate">{inviteResult.invite_link}</p>}
                            </div>
                            <button onClick={copyInvite} className="btn-secondary !py-1 text-[11px] flex-shrink-0">{inviteCopied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Link</>}</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Roster */}
                  <div className="space-y-1.5">
                    {data.members.length ? data.members.map(m => {
                      const isOwnerRow = data.owner && m.id === data.owner.id
                      return (
                        <div key={m.id} className="flex items-center gap-3 py-2 border-b border-divider last:border-0 group">
                          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0"><span className="text-xs font-bold text-brand-700">{m.name?.charAt(0)?.toUpperCase()}</span></div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ink truncate flex items-center gap-1.5">{m.name}{isOwnerRow && <Crown size={12} className="text-amber-500 flex-shrink-0" title="Owner" />}</p>
                            <p className="text-[11px] text-gray-400 truncate">{m.email}</p>
                          </div>
                          <select value={m.role} onChange={e => changeRole(m, e.target.value)} className="text-[11px] font-medium border border-rule rounded-md px-1.5 py-1 bg-card text-gray-600 cursor-pointer flex-shrink-0">
                            {MEMBER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          {!isOwnerRow && <button onClick={() => makeOwner(m)} title="Make owner" className="text-gray-300 hover:text-amber-500 p-1 flex-shrink-0"><Crown size={14} /></button>}
                          <button onClick={() => removeMember(m)} title="Remove" className="text-gray-300 hover:text-red-600 p-1 flex-shrink-0"><Trash2 size={14} /></button>
                        </div>
                      )
                    }) : <p className="text-sm text-gray-400">No members yet. Invite someone to get started.</p>}
                  </div>
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

                  {/* Billing & plan */}
                  <div>
                    <h3 className="text-sm font-bold text-ink mb-2 flex items-center gap-1.5"><CreditCard size={14} /> Plan & billing</h3>
                    <div className="grid grid-cols-2 gap-3 mb-2">
                      <div>
                        <label className="label">Plan</label>
                        <select className="input" value={billing.plan} onChange={e => setBilling(b => ({ ...b, plan: e.target.value }))}>
                          {PLANS.map(p => <option key={p.key} value={p.key}>{p.name}{p.price ? ` · $${p.price}/mo` : ' · free'}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Billing status</label>
                        <select className="input" value={billing.billing_status} onChange={e => setBilling(b => ({ ...b, billing_status: e.target.value }))}>
                          {BILLING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    <label className="label">MRR override (optional)</label>
                    <div className="flex items-center gap-2 mb-2">
                      <input type="number" step="0.01" min="0" className="input !w-40" value={billing.mrr_override} onChange={e => setBilling(b => ({ ...b, mrr_override: e.target.value }))} placeholder={`Default ${money(PLAN[billing.plan]?.price)}`} />
                      <span className="text-xs text-gray-400">Leave blank to use the plan's list price.</span>
                    </div>
                    {(() => {
                      const used = data.members?.length || 0
                      const limit = PLAN[billing.plan]?.seats
                      const over = limit != null && used > limit
                      return (
                        <div className="rounded-lg bg-page/50 p-3 mb-3">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-gray-500">Seats</span>
                            <span className={over ? 'text-red-600 font-semibold' : 'text-gray-600'}>{used}{limit != null ? ` / ${limit}` : ' · unlimited'}</span>
                          </div>
                          {limit != null && <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden"><div className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, Math.round((used / limit) * 100))}%` }} /></div>}
                          {over && <p className="text-[11px] text-red-600 mt-1">Over the plan's seat allowance.</p>}
                        </div>
                      )
                    })()}
                    <button onClick={saveBilling} disabled={billingSaving} className="btn-primary !py-1.5 text-xs">{billingSaving ? 'Saving…' : 'Save plan'}</button>
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

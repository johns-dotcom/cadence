import { useEffect, useState } from 'react'
import { Plus, Trash2, ShieldCheck, Copy, Check, Mail, Send, SlidersHorizontal, X, Pencil } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

const PAGE_NAMES = { '/workspaces': 'Workspaces', '/calendar': 'Calendar', '/activity': 'Activity', '/announcements': 'Announcements' }

// Owner-only: manage platform operators. Owners have full powers; Workspace
// Admins can enter/manage any workspace but not provision/suspend/delete or
// manage operators.
export default function PlatformOperators({ embedded = false } = {}) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [operators, setOperators] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [invite, setInvite] = useState(null)
  const [copied, setCopied] = useState(false)

  const load = () => { setLoading(true); api.get('/platform/operators').then(r => setOperators(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) { toast('Name and email are required', 'error'); return }
    setSaving(true)
    try {
      const { data } = await api.post('/platform/operators', form)
      setInvite(data.data)
      toast(data.data.email_sent ? `Invite emailed to ${data.data.email}` : 'Workspace Admin added — share the invite link')
      setForm({ name: '', email: '' }); setShowForm(false); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed to add operator', 'error') }
    finally { setSaving(false) }
  }

  const resend = async (op) => {
    setSaving(true)
    try {
      const { data } = await api.post('/platform/operators', { name: op.name, email: op.email })
      setInvite(data.data)
      toast(data.data.email_sent ? 'Invite resent' : 'New invite link ready — share it')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSaving(false) }
  }

  const revoke = async (op) => {
    if (!window.confirm(`Revoke ${op.name || op.email} as a Workspace Admin? They lose access to all workspaces.`)) return
    try { await api.delete(`/platform/operators/${encodeURIComponent(op.email)}`); toast('Revoked'); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const copyInvite = (link) => navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })

  const [accessOp, setAccessOp] = useState(null)
  const [renameEmail, setRenameEmail] = useState(null)
  const [renameVal, setRenameVal] = useState('')

  const startRename = (op) => { setRenameEmail(op.email); setRenameVal(op.name || '') }
  const saveRename = async () => {
    if (!renameVal.trim()) { toast('Name cannot be empty', 'error'); return }
    try { await api.patch(`/platform/operators/${encodeURIComponent(renameEmail)}`, { name: renameVal.trim() }); setRenameEmail(null); toast('Name updated'); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  // What this operator can actually reach — surfaced inline so the roster is
  // auditable without opening the modal. ws_scoped=0 means the allowlist is
  // empty = ALL workspaces (the inverse-state rule the server documents).
  const accessLine = (op) => {
    if (op.platform_role === 'owner') return 'Full access — every workspace'
    const scope = op.ws_scoped > 0 ? `${op.ws_scoped} workspace${op.ws_scoped === 1 ? '' : 's'}` : 'All workspaces'
    return `${scope} · ${op.default_role || 'Admin'}${op.page_scoped > 0 ? ' · some pages hidden' : ''}`
  }

  return (
    <div>
      {embedded ? (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-bold text-ink">Operators</h2>
            <p className="text-xs text-ink-muted">Platform owners and Workspace Admins</p>
          </div>
          <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add Workspace Admin</button>
        </div>
      ) : (
      <PageHeader
        title="Operators"
        subtitle="Platform owners and Workspace Admins"
        action={<button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add Workspace Admin</button>}
      />
      )}

      {invite && (
        <div className="card p-4 mb-6 border-brand-500/30 bg-brand-500/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink flex items-center gap-1.5">
                {invite.email_sent ? <><Mail size={14} className="text-success" /> Invite emailed to {invite.email}</> : 'Workspace Admin created — share this link'}
              </p>
              {!invite.email_sent && invite.email_error && <p className="text-[11px] text-warning mt-1">Email not sent: {invite.email_error}</p>}
              <p className="text-xs text-brand-ink font-mono break-all mt-1">{invite.invite_link}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => copyInvite(invite.invite_link)} className="btn-secondary !py-1.5 text-xs">{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</button>
              <button onClick={() => setInvite(null)} className="text-ink-faint hover:text-ink text-xs">Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label">Name</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></div>
          <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="they'll get an invite" /></div>
          <div className="flex items-end"><button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Sending…' : 'Send invite'}</button></div>
        </form>
      )}

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={4} cols={3} /></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left text-[10px] text-ink-faint uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Operator</th>
                <th className="px-4 py-3 font-semibold">Tier</th>
                <th className="px-4 py-3 font-semibold">Access</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {operators.map(op => (
                <tr key={op.email} className="hover:bg-elev">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${op.platform_role === 'owner' ? '' : 'bg-elev'}`}
                           style={op.platform_role === 'owner' ? { background: 'linear-gradient(135deg,#111827,rgb(var(--color-brand-600)))' } : undefined}>
                        <span className={`text-xs font-bold ${op.platform_role === 'owner' ? 'text-white' : 'text-ink-muted'}`}>{(op.name || op.email)?.charAt(0)?.toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        {renameEmail === op.email ? (
                          <div className="flex items-center gap-1.5">
                            <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenameEmail(null) }} className="input !py-1 text-sm !w-48" />
                            <button onClick={saveRename} className="text-emerald-600 hover:text-emerald-700" title="Save"><Check size={15} /></button>
                            <button onClick={() => setRenameEmail(null)} className="text-ink-faint hover:text-ink" title="Cancel"><X size={15} /></button>
                          </div>
                        ) : (
                          <p className="font-medium text-ink flex items-center gap-2 group">
                            {op.name}
                            <button onClick={() => startRename(op)} className="text-ink-faint hover:text-brand-ink opacity-0 group-hover:opacity-100 transition" title="Rename"><Pencil size={12} /></button>
                            {op.pending && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warning/15 text-warning">Invite pending</span>}
                            {op.email === user?.email && <span className="text-[10px] text-ink-faint">(you)</span>}
                          </p>
                        )}
                        <p className="text-xs text-ink-faint">{op.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${op.platform_role === 'owner' ? 'bg-brand-500/15 text-brand-ink' : 'bg-brand-500/10 text-brand-ink'}`}>
                      <ShieldCheck size={12} /> {op.platform_role === 'owner' ? 'Owner' : 'Workspace Admin'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-ink-muted">{accessLine(op)}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {op.platform_role === 'admin' && (
                      <div className="inline-flex items-center gap-1.5">
                        {op.pending && <button onClick={() => resend(op)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:opacity-80 mr-1"><Send size={13} /> Resend</button>}
                        <button onClick={() => setAccessOp(op)} className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border border-rule text-ink-muted hover:text-ink hover:bg-elev transition" title="Which workspaces and pages this operator can reach"><SlidersHorizontal size={13} /> Access</button>
                        <button onClick={() => revoke(op)} className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg text-ink-muted hover:text-danger hover:bg-danger/10 transition" title="Revoke all access"><Trash2 size={13} /> Revoke</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {accessOp && <AccessModal op={accessOp} onClose={() => setAccessOp(null)} onSaved={() => { setAccessOp(null); toast('Access updated') }} />}
    </div>
  )
}

// Owner-managed access modal: which workspaces the admin operator may enter and
// which console pages they may view. Empty selection = unrestricted.
function AccessModal({ op, onClose, onSaved }) {
  const { toast } = useToast()
  const [workspaces, setWorkspaces] = useState([])
  // What they may BE inside a workspace. A default plus overrides: a newly
  // granted workspace then inherits a decision instead of needing one before
  // they can use it.
  const [defaultRole, setDefaultRole] = useState('')
  const [wsRoles, setWsRoles] = useState({})
  const [roleOptions, setRoleOptions] = useState(['Superadmin', 'Admin', 'Approver', 'User'])
  const [fallbackRole, setFallbackRole] = useState('Admin')
  const [restrictablePages, setRestrictablePages] = useState([])
  const [wsMode, setWsMode] = useState('all')   // 'all' | 'specific'
  const [pageMode, setPageMode] = useState('all')
  const [wsSel, setWsSel] = useState([])
  const [pageSel, setPageSel] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get('/platform/workspaces').then(r => setWorkspaces(r.data.data || [])).catch(() => {}),
      api.get(`/platform/operators/${encodeURIComponent(op.email)}/access`).then(r => {
        const d = r.data.data
        setRestrictablePages(d.restrictablePages || [])
        if (d.workspaces) { setWsMode('specific'); setWsSel(d.workspaces) }
        if (d.pages) { setPageMode('specific'); setPageSel(d.pages) }
        if (d.assignableRoles?.length) setRoleOptions(d.assignableRoles)
        if (d.defaultRole) setFallbackRole(d.defaultRole)
        setDefaultRole(d.roles?.default || '')
        setWsRoles(d.roles?.byLabel || {})
      }).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [op.email])

  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v])

  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/platform/operators/${encodeURIComponent(op.email)}/access`, {
        workspaces: wsMode === 'specific' ? wsSel : null,
        pages: pageMode === 'specific' ? pageSel : null,
        default_role: defaultRole || null,
        workspace_roles: wsRoles,
      })
      onSaved()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-8 bg-overlay overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg bg-card rounded-2xl border border-rule shadow-modal my-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-divider">
          <div><h2 className="text-base font-semibold text-ink">Access · {op.name}</h2><p className="text-[11px] text-ink-faint">{op.email}</p></div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink"><X size={18} /></button>
        </div>
        {loading ? <div className="p-6"><Skeleton.TaskList count={4} /></div> : (
          <div className="p-5 space-y-5 max-h-[65vh] overflow-y-auto">
            {/* Workspaces */}
            <div>
              <h3 className="text-sm font-bold text-ink mb-2">Workspaces they can enter</h3>
              <div className="flex gap-2 mb-2">
                {['all', 'specific'].map(m => (
                  <button key={m} onClick={() => setWsMode(m)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${wsMode === m ? 'bg-brand-500/10 border-brand-300 text-brand-ink' : 'border-rule text-ink-muted'}`}>{m === 'all' ? 'All workspaces' : 'Specific'}</button>
                ))}
              </div>
              {wsMode === 'specific' && (
                <div className="border border-rule rounded-lg p-2 max-h-40 overflow-y-auto space-y-0.5">
                  {workspaces.map(w => (
                    <label key={w.id} className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer px-1 py-0.5 rounded hover:bg-elev">
                      <input type="checkbox" checked={wsSel.includes(w.id)} onChange={() => toggle(wsSel, setWsSel, w.id)} /> {w.name}
                    </label>
                  ))}
                  {!workspaces.length && <p className="text-xs text-ink-faint">No workspaces.</p>}
                </div>
              )}
            </div>
            {/* What they may DO inside a workspace. This is the half that is
                enforced: every route in the app gates on role, so a tier set
                here is a real limit, not a hidden menu item. */}
            <div>
              <h3 className="text-sm font-bold text-ink mb-2">What they can do inside a workspace</h3>
              <p className="text-[11px] text-ink-faint mb-2">
                The role their identity takes when they enter. Enforced on every request — an Approver
                cannot reach admin-only finance routes, a User cannot read the ledger. Changing it ends
                their current session in that workspace; their console session is untouched.
              </p>
              <label className="flex items-center gap-2 text-sm text-ink-muted mb-2">
                <span className="w-28 flex-shrink-0 text-xs font-semibold text-ink-muted">Default</span>
                <select
                  className="input !h-8 text-sm"
                  value={defaultRole}
                  onChange={e => setDefaultRole(e.target.value)}
                >
                  <option value="">{fallbackRole} (unchanged)</option>
                  {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              {(wsMode === 'specific' ? workspaces.filter(w => wsSel.includes(w.id)) : workspaces).length > 0 && (
                <div className="border border-rule rounded-lg p-2 max-h-48 overflow-y-auto space-y-1">
                  <p className="text-[11px] text-ink-faint px-1">Override per workspace — blank inherits the default.</p>
                  {(wsMode === 'specific' ? workspaces.filter(w => wsSel.includes(w.id)) : workspaces).map(w => (
                    <label key={w.id} className="flex items-center gap-2 text-sm text-ink-muted px-1">
                      <span className="flex-1 min-w-0 truncate">{w.name}</span>
                      <select
                        className="input !h-7 !w-auto text-xs"
                        value={wsRoles[w.id] || ''}
                        onChange={e => setWsRoles(r => {
                          const next = { ...r }
                          if (e.target.value) next[w.id] = e.target.value
                          else delete next[w.id]   // cleared → inherit, not "no access"
                          return next
                        })}
                      >
                        <option value="">Default ({defaultRole || fallbackRole})</option>
                        {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Pages */}
            <div>
              <h3 className="text-sm font-bold text-ink mb-2">Console pages they can view</h3>
              <p className="text-[11px] text-ink-faint mb-2">Overview and Settings are always available.</p>
              <div className="flex gap-2 mb-2">
                {['all', 'specific'].map(m => (
                  <button key={m} onClick={() => setPageMode(m)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${pageMode === m ? 'bg-brand-500/10 border-brand-300 text-brand-ink' : 'border-rule text-ink-muted'}`}>{m === 'all' ? 'All pages' : 'Specific'}</button>
                ))}
              </div>
              {pageMode === 'specific' && (
                <div className="border border-rule rounded-lg p-2 space-y-0.5">
                  {restrictablePages.map(p => (
                    <label key={p} className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer px-1 py-0.5 rounded hover:bg-elev">
                      <input type="checkbox" checked={pageSel.includes(p)} onChange={() => toggle(pageSel, setPageSel, p)} /> {PAGE_NAMES[p] || p}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-divider">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving || loading} className="btn-primary">{saving ? 'Saving…' : 'Save access'}</button>
        </div>
      </div>
    </div>
  )
}

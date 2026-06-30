import { useEffect, useState } from 'react'
import { Plus, Trash2, ShieldCheck, Copy, Check, Mail, Send } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

// Owner-only: manage platform operators. Owners have full powers; Workspace
// Admins can enter/manage any workspace but not provision/suspend/delete or
// manage operators.
export default function PlatformOperators() {
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
  useEffect(load, [])

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

  return (
    <div>
      <PageHeader
        title="Operators"
        subtitle="Platform owners and Workspace Admins"
        action={<button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add Workspace Admin</button>}
      />

      {invite && (
        <div className="card p-4 mb-6 border-brand-200 bg-brand-50/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink flex items-center gap-1.5">
                {invite.email_sent ? <><Mail size={14} className="text-emerald-600" /> Invite emailed to {invite.email}</> : 'Workspace Admin created — share this link'}
              </p>
              {!invite.email_sent && invite.email_error && <p className="text-[11px] text-amber-700 mt-1">Email not sent: {invite.email_error}</p>}
              <p className="text-xs text-brand-700 font-mono break-all mt-1">{invite.invite_link}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => copyInvite(invite.invite_link)} className="btn-secondary !py-1.5 text-xs">{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</button>
              <button onClick={() => setInvite(null)} className="text-gray-400 hover:text-gray-600 text-xs">Dismiss</button>
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
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left text-[10px] text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Operator</th>
                <th className="px-4 py-3 font-semibold">Tier</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {operators.map(op => (
                <tr key={op.email} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink flex items-center gap-2">
                      {op.name}
                      {op.pending && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Invite pending</span>}
                      {op.email === user?.email && <span className="text-[10px] text-gray-400">(you)</span>}
                    </p>
                    <p className="text-xs text-gray-400">{op.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${op.platform_role === 'owner' ? 'bg-brand-100 text-brand-700' : 'bg-indigo-100 text-indigo-700'}`}>
                      <ShieldCheck size={12} /> {op.platform_role === 'owner' ? 'Owner' : 'Workspace Admin'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {op.platform_role === 'admin' && (
                      <>
                        {op.pending && <button onClick={() => resend(op)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 mr-3"><Send size={13} /> Resend</button>}
                        <button onClick={() => revoke(op)} className="text-gray-400 hover:text-danger" title="Revoke"><Trash2 size={15} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

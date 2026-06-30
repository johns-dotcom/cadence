import { useEffect, useState } from 'react'
import { Plus, Trash2, Copy, Check, Send, Mail } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { ROLES, DEPARTMENTS } from '../constants'

const ROLE_STYLES = {
  Superadmin: 'bg-brand-100 text-brand-700',
  Admin:      'bg-indigo-100 text-indigo-700',
  Approver:   'bg-amber-100 text-amber-700',
  User:       'bg-gray-100 text-gray-600',
}

export default function Team() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: 'User', department: 'Operations' })
  const [saving, setSaving] = useState(false)
  const [invite, setInvite] = useState(null) // last invite: { link, email_sent, email }
  const [copied, setCopied] = useState(false)

  const load = () => {
    setLoading(true)
    api.get('/team').then(res => setMembers(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) {
      toast('Name and email are required', 'error'); return
    }
    setSaving(true)
    try {
      const { data } = await api.post('/team', form)
      setInvite({ link: data.data.invite_link, email_sent: data.data.email_sent, email: data.data.email, email_error: data.data.email_error })
      toast(data.data.email_sent ? `Invite emailed to ${data.data.email}` : 'Member added — share the invite link')
      setForm({ name: '', email: '', role: 'User', department: 'Operations' })
      setShowForm(false); load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add member', 'error')
    } finally { setSaving(false) }
  }

  const copyInvite = (link) => navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })

  const resend = async (id, name) => {
    try {
      const { data } = await api.post(`/team/${id}/resend`)
      setInvite({ link: data.data.invite_link, email_sent: data.data.email_sent, email: name, email_error: data.data.email_error })
      toast(data.data.email_sent ? 'Invite resent' : 'New invite link ready — share it')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const changeRole = async (id, role) => {
    try { await api.patch(`/team/${id}`, { role }); toast('Role updated'); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const remove = async (id, name) => {
    if (!window.confirm(`Remove ${name} from the workspace?`)) return
    try { await api.delete(`/team/${id}`); toast('Member removed'); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle="Members of this workspace"
        action={<button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Invite member</button>}
      />

      {/* Invite result — shows the link to copy (and whether the email sent). */}
      {invite && (
        <div className="card p-4 mb-6 border-brand-200 bg-brand-50/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink flex items-center gap-1.5">
                {invite.email_sent ? <><Mail size={14} className="text-emerald-600" /> Invite emailed{invite.email ? ` to ${invite.email}` : ''}</> : 'Invite created — share this link'}
              </p>
              {!invite.email_sent && invite.email_error && (
                <p className="text-[11px] text-amber-700 mt-1">Email not sent: {invite.email_error}</p>
              )}
              <p className="text-xs text-brand-700 font-mono break-all mt-1">{invite.link}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => copyInvite(invite.link)} className="btn-secondary !py-1.5 text-xs">{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</button>
              <button onClick={() => setInvite(null)} className="text-gray-400 hover:text-gray-600 text-xs">Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div><label className="label">Name</label><input className="input" value={form.name} onChange={set('name')} autoFocus /></div>
          <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={set('email')} placeholder="they'll get an invite" /></div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={set('role')}>{ROLES.map(r => <option key={r}>{r}</option>)}</select>
          </div>
          <div>
            <label className="label">Department</label>
            <select className="input" value={form.department} onChange={set('department')}>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}</select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4"><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Sending…' : 'Send invite'}</button></div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Member</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Department</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Role</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {members.map(m => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink flex items-center gap-2">{m.name}
                      {m.pending && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Invite pending</span>}
                    </p>
                    <p className="text-xs text-gray-400">{m.email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{m.department || '—'}</td>
                  <td className="px-4 py-3">
                    {/* Superadmin can reassign roles; the owner row stays read-only here. */}
                    {user?.role === 'Superadmin' && m.id !== user.id ? (
                      <select
                        value={m.role}
                        onChange={e => changeRole(m.id, e.target.value)}
                        className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer ${ROLE_STYLES[m.role] || ROLE_STYLES.User}`}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLES[m.role] || ROLE_STYLES.User}`}>{m.role}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {m.pending && (
                      <button onClick={() => resend(m.id, m.email)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 mr-3" title="Resend invite">
                        <Send size={13} /> Resend
                      </button>
                    )}
                    {m.id !== user?.id && (
                      <button onClick={() => remove(m.id, m.name)} className="text-gray-400 hover:text-danger transition-colors" title="Remove">
                        <Trash2 size={15} />
                      </button>
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

// Team — the workspace people directory, and the admin surface for inviting,
// re-roling and removing members.
//
// Two things changed shape here. It is no longer admin-only: knowing who is on the
// team and what they are carrying is not a privileged fact, and gating the ONLY
// people directory behind AdminRoute left a plain User with no way to look anyone
// up. Read is open to every member; every mutation stays admin-tier and is enforced
// server-side (routes/team.js requireAdmin + the escalation guards), so the page
// simply stops rendering controls it knows will 403.
//
// The roster also carries a task rollup per person, served by GET /api/team — the
// "who is carrying what" glance boom's /team had and this page had lost entirely.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, Copy, Check, Send, Mail, BarChart3, Users } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import TeamVelocity from '../components/TeamVelocity'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { ROLES, DEPARTMENTS } from '../constants'

// boom's tones, restored: Superadmin is violet (the "above admin" colour), Admin
// carries the accent, Approver amber. Translucent `/15` fills — the solid `-100`
// scale washes out in dark and takes its text with it.
const ROLE_STYLES = {
  Superadmin: 'bg-violet-500/15 text-violet-600',
  Admin:      'bg-brand-500/15 text-brand-ink',
  Approver:   'bg-amber-500/15 text-amber-600',
  User:       'bg-gray-100 text-ink-muted',
}

// hierarchy_level is a small number = senior. boom drew an EXEC badge at <= 2 and
// ordered the roster by it; the field existed here but nothing displayed or set it,
// so every invitee landed at the default 99 and the ordering was frozen flat.
const EXEC_LEVEL = 2
const HIERARCHY_LEVELS = [
  { value: 1, label: '1 · Executive' },
  { value: 2, label: '2 · Director' },
  { value: 5, label: '5 · Lead' },
  { value: 10, label: '10 · Manager' },
  { value: 99, label: '99 · Member' },
]

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

function Avatar({ member, isSelf, alert }) {
  return (
    <span
      aria-hidden="true"
      className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0
        ${alert ? 'bg-red-500/15 text-red-600'
          : isSelf ? 'bg-brand-500/15 text-brand-ink'
            : 'bg-gray-100 text-ink-muted'}`}
    >
      {initials(member.name)}
    </span>
  )
}

// Done-% + the counts behind it. Rendered only when the person has any tasks —
// a 0/0 bar reads as "nothing done" rather than "nothing assigned".
function TaskRollup({ m }) {
  const total = Number(m.total_tasks || 0)
  if (!total) return <span className="text-[11px] text-ink-faint">No tasks</span>
  const done = Number(m.done_tasks || 0)
  const pct = Math.round((done / total) * 100)
  return (
    <div className="min-w-[8rem]">
      <div className="h-1.5 rounded-full bg-rule overflow-hidden">
        <div className={`h-full rounded-full ${pct === 100 ? 'bg-success' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center flex-wrap gap-x-1.5 mt-1 text-[10px]">
        <span className="text-ink-muted">{pct}%</span>
        {Number(m.overdue_tasks) > 0 && <span className="text-danger font-medium">{m.overdue_tasks} overdue</span>}
        {Number(m.in_progress_tasks) > 0 && <span className="text-ink-muted">{m.in_progress_tasks} active</span>}
        {Number(m.open_tasks) > 0 && <span className="text-ink-muted">{m.open_tasks} open</span>}
      </div>
    </div>
  )
}

export default function Team() {
  const { user } = useAuth()
  const { toast } = useToast()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const isSuper = user?.role === 'Superadmin'
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('people')     // 'people' | 'velocity'
  const [dept, setDept] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: 'User', department: 'Operations', hierarchy_level: 99 })
  const [saving, setSaving] = useState(false)
  const [invite, setInvite] = useState(null) // last invite: { link, email_sent, email }
  const [copied, setCopied] = useState(false)

  const load = () => {
    setLoading(true)
    api.get('/team').then(res => setMembers(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) {
      toast('Name and email are required', 'error'); return
    }
    setSaving(true)
    try {
      const { data } = await api.post('/team', { ...form, hierarchy_level: Number(form.hierarchy_level) || 99 })
      setInvite({ link: data.data.invite_link, email_sent: data.data.email_sent, email: data.data.email, email_error: data.data.email_error })
      toast(data.data.email_sent ? `Invite emailed to ${data.data.email}` : 'Member added — share the invite link')
      setForm({ name: '', email: '', role: 'User', department: 'Operations', hierarchy_level: 99 })
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

  const patchMember = async (id, fields, successMsg) => {
    try { await api.patch(`/team/${id}`, fields); toast(successMsg); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const changeRole = (id, role) => patchMember(id, { role }, 'Role updated')

  // Department is not cosmetic: it decides which teammates an Approver can see and
  // reassign on Team Work. Changing it signs the member out so the new scope takes
  // effect immediately, so say so rather than letting a silent logout surprise them.
  const changeDepartment = (id, department) =>
    patchMember(id, { department }, `Moved to ${department} — they'll be signed out`)

  const changeHierarchy = (id, hierarchy_level) =>
    patchMember(id, { hierarchy_level: Number(hierarchy_level) }, 'Seniority updated')

  const remove = async (id, name) => {
    if (!window.confirm(`Remove ${name} from the workspace?`)) return
    try { await api.delete(`/team/${id}`); toast('Member removed'); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  // Department tabs, only listing departments that actually have people in them —
  // six empty tabs on a five-person workspace is noise.
  const presentDepts = useMemo(
    () => DEPARTMENTS.filter(d => members.some(m => m.department === d)),
    [members]
  )
  const shown = dept === 'all' ? members : members.filter(m => m.department === dept)
  const activeTasks = members.reduce((n, m) => n + Number(m.open_tasks || 0), 0)

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle={loading ? 'Members of this workspace' : `${members.length} member${members.length === 1 ? '' : 's'} · ${activeTasks} active task${activeTasks === 1 ? '' : 's'}`}
        action={
          <div className="flex items-center gap-2">
            {/* Velocity is admin-only because its endpoint is (requireAdmin). */}
            {isAdmin && (
              <div className="flex items-center gap-0.5 bg-page rounded-lg p-0.5">
                {[['people', 'People', Users], ['velocity', 'Velocity', BarChart3]].map(([k, lbl, Icon]) => (
                  <button
                    key={k}
                    onClick={() => setView(k)}
                    aria-pressed={view === k}
                    className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md transition
                      ${view === k ? 'bg-card shadow-sm ring-1 ring-rule text-ink' : 'text-ink-muted hover:text-ink'}`}
                  >
                    <Icon size={13} aria-hidden="true" /> {lbl}
                  </button>
                ))}
              </div>
            )}
            {isAdmin && (
              <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Invite member</button>
            )}
          </div>
        }
      />

      {isAdmin && view === 'velocity' ? <TeamVelocity /> : (
        <>
          {/* Invite result — shows the link to copy (and whether the email sent). */}
          {invite && (
            <div className="card p-4 mb-6 border-brand-200 bg-brand-500/10">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink flex items-center gap-1.5">
                    {invite.email_sent ? <><Mail size={14} className="text-success" /> Invite emailed{invite.email ? ` to ${invite.email}` : ''}</> : 'Invite created — share this link'}
                  </p>
                  {!invite.email_sent && invite.email_error && (
                    <p className="text-[11px] text-warning mt-1">Email not sent: {invite.email_error}</p>
                  )}
                  <p className="text-xs text-brand-ink font-mono break-all mt-1">{invite.link}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => copyInvite(invite.link)} className="btn-secondary !py-1.5 text-xs">{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</button>
                  <button onClick={() => setInvite(null)} className="text-ink-muted hover:text-ink text-xs">Dismiss</button>
                </div>
              </div>
            </div>
          )}

          {showForm && isAdmin && (
            <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div><label className="label">Name</label><input className="input" value={form.name} onChange={set('name')} autoFocus /></div>
              <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={set('email')} placeholder="they'll get an invite" /></div>
              <div>
                <label className="label">Role</label>
                {/* Only a Superadmin can grant an admin-tier role — the server 403s
                    either way, so don't offer the option that will bounce. */}
                <select className="input" value={form.role} onChange={set('role')}>
                  {ROLES.filter(r => isSuper || !['Superadmin', 'Admin'].includes(r)).map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Department</label>
                <select className="input" value={form.department} onChange={set('department')}>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}</select>
              </div>
              <div>
                <label className="label">Seniority</label>
                <select className="input" value={form.hierarchy_level} onChange={set('hierarchy_level')}>
                  {HIERARCHY_LEVELS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-5"><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Sending…' : 'Send invite'}</button></div>
            </form>
          )}

          {/* Department tabs. Underline tabs, matching the app's other tab strips. */}
          {presentDepts.length > 1 && (
            <div className="flex items-center gap-4 border-b border-divider mb-4 overflow-x-auto">
              {[['all', 'Everyone'], ...presentDepts.map(d => [d, d])].map(([k, lbl]) => (
                <button
                  key={k}
                  onClick={() => setDept(k)}
                  aria-pressed={dept === k}
                  className={`text-xs font-medium pb-2 -mb-px border-b-2 whitespace-nowrap transition
                    ${dept === k ? 'border-brand-500 text-brand-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
                >
                  {lbl} {k !== 'all' && <span className="text-ink-faint">{members.filter(m => m.department === k).length}</span>}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <Skeleton.Table rows={5} cols={5} />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-divider text-left">
                    <th scope="col" className="px-4 py-3 text-[10px] font-semibold text-ink-muted uppercase tracking-wide">Member</th>
                    <th scope="col" className="px-4 py-3 text-[10px] font-semibold text-ink-muted uppercase tracking-wide">Tasks</th>
                    <th scope="col" className="px-4 py-3 text-[10px] font-semibold text-ink-muted uppercase tracking-wide">Department</th>
                    <th scope="col" className="px-4 py-3 text-[10px] font-semibold text-ink-muted uppercase tracking-wide">Role</th>
                    {isAdmin && <th scope="col" className="px-4 py-3 text-[10px] font-semibold text-ink-muted uppercase tracking-wide">Seniority</th>}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {shown.map(m => {
                    const isSelf = m.id === user?.id
                    const isExec = Number(m.hierarchy_level) <= EXEC_LEVEL
                    return (
                      <tr key={m.id} className="hover:bg-elev transition">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar member={m} isSelf={isSelf} alert={Number(m.overdue_tasks) > 0} />
                            <div className="min-w-0">
                              <p className="font-medium text-ink flex items-center flex-wrap gap-1.5">
                                <Link to={`/team/${m.id}`} className="hover:text-brand-ink">{m.name}</Link>
                                {isSelf && <span className="text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-gray-100 text-ink-muted">You</span>}
                                {isExec && <span className="text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-violet-500/15 text-violet-600">Exec</span>}
                                {m.pending && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600">Invite pending</span>}
                              </p>
                              <p className="text-[11px] text-ink-muted">{m.email}</p>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3"><TaskRollup m={m} /></td>

                        <td className="px-4 py-3 text-ink-muted">
                          {/* Editable for admin-tier (matching requireAdmin on PATCH /team) —
                              department scopes Team Work, so it has to be fixable after invite. */}
                          {isAdmin ? (
                            <select
                              value={m.department || ''}
                              onChange={e => changeDepartment(m.id, e.target.value)}
                              aria-label={`Department for ${m.name}`}
                              className="text-xs font-medium rounded-md px-1.5 py-1 border border-rule bg-card text-ink-muted cursor-pointer"
                            >
                              {/* Placeholder only — the server rejects a blank department,
                                  and clearing one would drop the member out of Team Work. */}
                              {!m.department && <option value="" disabled>—</option>}
                              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          ) : (m.department || '—')}
                        </td>

                        <td className="px-4 py-3">
                          {/* Superadmin can reassign roles; the owner row stays read-only here. */}
                          {isSuper && !isSelf ? (
                            <select
                              value={m.role}
                              onChange={e => changeRole(m.id, e.target.value)}
                              aria-label={`Role for ${m.name}`}
                              className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer ${ROLE_STYLES[m.role] || ROLE_STYLES.User}`}
                            >
                              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          ) : (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLES[m.role] || ROLE_STYLES.User}`}>{m.role}</span>
                          )}
                        </td>

                        {isAdmin && (
                          <td className="px-4 py-3">
                            <select
                              value={HIERARCHY_LEVELS.some(h => h.value === Number(m.hierarchy_level)) ? Number(m.hierarchy_level) : 99}
                              onChange={e => changeHierarchy(m.id, e.target.value)}
                              aria-label={`Seniority for ${m.name}`}
                              className="text-xs rounded-md px-1.5 py-1 border border-rule bg-card text-ink-muted cursor-pointer"
                            >
                              {HIERARCHY_LEVELS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                            </select>
                          </td>
                        )}

                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {isAdmin && m.pending && (
                            <button onClick={() => resend(m.id, m.email)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline mr-3" title="Resend invite">
                              <Send size={13} /> Resend
                            </button>
                          )}
                          {isAdmin && !isSelf && (
                            <button onClick={() => remove(m.id, m.name)} className="text-ink-faint hover:text-danger transition-colors" title="Remove" aria-label={`Remove ${m.name}`}>
                              <Trash2 size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {shown.length === 0 && (
                    <tr><td colSpan={isAdmin ? 6 : 5} className="px-4 py-8 text-center text-sm text-ink-muted">Nobody in {dept}.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Plus, Building2, Copy, Check } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'

// Platform-admin only: provision and list label workspaces (tenants). This is
// the operator's onboarding surface — it replaces public self-serve signup.
export default function Workspaces() {
  const { toast } = useToast()
  const [workspaces, setWorkspaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ labelName: '', ownerName: '', ownerEmail: '', ownerPassword: '' })
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState(null) // last created {label, owner, password}
  const [copied, setCopied] = useState(false)

  const load = () => {
    setLoading(true)
    api.get('/platform/workspaces').then(res => setWorkspaces(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e.preventDefault()
    if (!form.labelName.trim() || !form.ownerName.trim() || !form.ownerEmail.trim() || form.ownerPassword.length < 8) {
      toast('All fields required; temp password must be 8+ characters', 'error'); return
    }
    setSaving(true)
    try {
      const { data } = await api.post('/platform/workspaces', form)
      setCreated({ ...data.data, password: form.ownerPassword })
      setForm({ labelName: '', ownerName: '', ownerEmail: '', ownerPassword: '' })
      setShowForm(false)
      toast('Workspace created')
      load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create workspace', 'error')
    } finally {
      setSaving(false)
    }
  }

  const copyHandoff = () => {
    if (!created) return
    const text = `Workspace: ${created.label.name}\nSign-in email: ${created.owner.email}\nTemporary password: ${created.password}\nWorkspace ID (if prompted): ${created.label.slug}`
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div>
      <PageHeader
        title="Workspaces"
        subtitle="Provision and manage label accounts on the platform"
        action={<button onClick={() => { setShowForm(v => !v); setCreated(null) }} className="btn-primary"><Plus size={16} /> New workspace</button>}
      />

      {/* Hand-off card shown right after creation (the only time the temp
          password is visible — it isn't stored in plaintext anywhere). */}
      {created && (
        <div className="card p-5 mb-6 border-brand-200 bg-brand-50/40">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-ink mb-2">Workspace created — share these credentials</h3>
              <dl className="text-sm space-y-1">
                <div className="flex gap-2"><dt className="text-gray-500 w-36">Workspace</dt><dd className="text-ink font-medium">{created.label.name}</dd></div>
                <div className="flex gap-2"><dt className="text-gray-500 w-36">Sign-in email</dt><dd className="text-ink font-medium">{created.owner.email}</dd></div>
                <div className="flex gap-2"><dt className="text-gray-500 w-36">Temporary password</dt><dd className="text-ink font-mono">{created.password}</dd></div>
                <div className="flex gap-2"><dt className="text-gray-500 w-36">Workspace ID</dt><dd className="text-ink font-mono">{created.label.slug}</dd></div>
              </dl>
              <p className="text-xs text-gray-400 mt-2">The owner should change this password after first sign-in.</p>
            </div>
            <button onClick={copyHandoff} className="btn-secondary flex-shrink-0">
              {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">Label name</label>
            <input className="input" value={form.labelName} onChange={set('labelName')} placeholder="e.g. Midnight Records" autoFocus />
          </div>
          <div><label className="label">Owner name</label><input className="input" value={form.ownerName} onChange={set('ownerName')} /></div>
          <div><label className="label">Owner email</label><input type="email" className="input" value={form.ownerEmail} onChange={set('ownerEmail')} /></div>
          <div className="sm:col-span-2"><label className="label">Temporary password</label><input type="text" className="input" value={form.ownerPassword} onChange={set('ownerPassword')} placeholder="8+ characters — share with the owner" /></div>
          <div className="sm:col-span-2"><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Creating…' : 'Create workspace'}</button></div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : workspaces.length === 0 ? (
        <div className="card p-10 text-center">
          <Building2 size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No workspaces yet.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Workspace</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Workspace ID</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Members</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {workspaces.map(w => (
                <tr key={w.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-ink">{w.name}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono">{w.slug}</td>
                  <td className="px-4 py-3 text-gray-600">{w.member_count}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(w.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

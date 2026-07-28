import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Building2, Copy, Check, LogIn, Search, Users, Music, Layers, Ban } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import WorkspaceDrawer from '../components/WorkspaceDrawer'

// Platform-admin command center: provision, monitor, and manage every label
// workspace (tenant) on the platform.
const fmtAgo = (d) => {
  if (!d) return 'never'
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`
  return new Date(d).toLocaleDateString()
}

const SORTS = [
  { key: 'created_at', label: 'Newest' },
  { key: 'name', label: 'Name' },
  { key: 'members', label: 'Members' },
  { key: 'releases', label: 'Releases' },
  { key: 'last_active', label: 'Last active' },
]

export default function Workspaces() {
  const { toast } = useToast()
  const { enterWorkspace, user } = useAuth()
  const isOwner = user?.platform_role === 'owner'
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ labelName: '', ownerName: '', ownerEmail: '' })
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState(null)
  const [copied, setCopied] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('created_at')
  const [drawerId, setDrawerId] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/platform/workspaces').then(res => setWorkspaces(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e.preventDefault()
    if (!form.labelName.trim() || !form.ownerName.trim() || !form.ownerEmail.trim()) {
      toast('Label name, owner name and email are required', 'error'); return
    }
    setSaving(true)
    try {
      const { data } = await api.post('/platform/workspaces', form)
      setCreated(data.data)
      setForm({ labelName: '', ownerName: '', ownerEmail: '' })
      setShowForm(false)
      toast(data.data.email_sent ? `Workspace created — invite emailed to ${data.data.owner.email}` : 'Workspace created — share the owner invite link'); load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create workspace', 'error')
    } finally { setSaving(false) }
  }

  const enter = async (w) => {
    const result = await enterWorkspace(w.id)
    if (result.success) navigate('/')
    else toast(result.error || 'Could not enter workspace', 'error')
  }

  const copyHandoff = () => {
    if (!created) return
    navigator.clipboard.writeText(`Workspace: ${created.label.name}\nOwner: ${created.owner.email}\nInvite link: ${created.invite_link}`)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  // Platform-wide rollups derived from the enriched list.
  const summary = useMemo(() => {
    const total = workspaces.length
    const active = workspaces.filter(w => w.status !== 'suspended').length
    const suspended = total - active
    const members = workspaces.reduce((s, w) => s + (w.members || 0), 0)
    const releases = workspaces.reduce((s, w) => s + (w.releases || 0), 0)
    const newThisMonth = workspaces.filter(w => (Date.now() - new Date(w.created_at).getTime()) < 2592000000).length
    return { total, active, suspended, members, releases, newThisMonth }
  }, [workspaces])

  const shown = useMemo(() => {
    let list = workspaces
    const q = query.trim().toLowerCase()
    if (q) list = list.filter(w => w.name?.toLowerCase().includes(q) || w.slug?.toLowerCase().includes(q) || w.owner?.email?.toLowerCase().includes(q))
    const dir = sort === 'name' ? 1 : -1
    return [...list].sort((a, b) => {
      let av = a[sort], bv = b[sort]
      if (sort === 'name') return (av || '').localeCompare(bv || '')
      if (sort === 'created_at' || sort === 'last_active') { av = av ? new Date(av).getTime() : 0; bv = bv ? new Date(bv).getTime() : 0 }
      return (bv - av) * (dir === -1 ? 1 : 1)
    })
  }, [workspaces, query, sort])

  const CARDS = [
    { label: 'Workspaces', value: summary.total, icon: Building2, chip: 'bg-indigo-100 text-indigo-600' },
    { label: 'Active', value: summary.active, icon: Check, chip: 'bg-emerald-100 text-emerald-600' },
    { label: 'Suspended', value: summary.suspended, icon: Ban, chip: 'bg-rose-100 text-rose-600', dim: summary.suspended === 0 },
    { label: 'Members', value: summary.members, icon: Users, chip: 'bg-sky-100 text-sky-600' },
    { label: 'Releases', value: summary.releases, icon: Music, chip: 'bg-violet-100 text-violet-600' },
    { label: 'New (30d)', value: summary.newThisMonth, icon: Layers, chip: 'bg-amber-100 text-amber-600' },
  ]

  return (
    <div>
      <PageHeader
        title="Workspaces"
        subtitle="Provision, monitor and manage every label account on the platform"
        action={isOwner ? <button onClick={() => { setShowForm(v => !v); setCreated(null) }} className="btn-primary"><Plus size={16} /> New workspace</button> : null}
      />

      {/* Platform summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {CARDS.map(c => {
          const Icon = c.icon
          return (
            <div key={c.label} className="card p-4 flex items-center gap-3 transition-shadow hover:shadow-sm">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${c.chip}`}><Icon size={17} /></div>
              <div className="min-w-0">
                <p className={`text-2xl font-bold leading-none ${c.dim ? 'text-gray-300' : 'text-ink'}`}>{c.value}</p>
                <p className="text-[11px] text-gray-400 mt-1 truncate">{c.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      {created && (
        <div className="card p-5 mb-6 border-brand-200 bg-brand-50/40">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-ink mb-2">
                {created.email_sent ? `Workspace created — invite emailed to ${created.owner.email}` : 'Workspace created — share the owner invite link'}
              </h3>
              <dl className="text-sm space-y-1">
                <div className="flex gap-2"><dt className="text-gray-500 w-36">Workspace</dt><dd className="text-ink font-medium">{created.label.name}</dd></div>
                <div className="flex gap-2"><dt className="text-gray-500 w-36">Owner</dt><dd className="text-ink font-medium">{created.owner.email}</dd></div>
                <div className="flex gap-2"><dt className="text-gray-500 w-36">Workspace ID</dt><dd className="text-ink font-mono">{created.label.slug}</dd></div>
                <div className="flex gap-2"><dt className="text-gray-500 w-36">Invite link</dt><dd className="text-brand-700 font-mono break-all">{created.invite_link}</dd></div>
              </dl>
              <p className="text-xs text-gray-400 mt-2">The owner sets their own password from this link (expires in 7 days).</p>
            </div>
            <button onClick={copyHandoff} className="btn-secondary flex-shrink-0">{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}</button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><label className="label">Label name</label><input className="input" value={form.labelName} onChange={set('labelName')} placeholder="e.g. Midnight Records" autoFocus /></div>
          <div><label className="label">Owner name</label><input className="input" value={form.ownerName} onChange={set('ownerName')} /></div>
          <div><label className="label">Owner email</label><input type="email" className="input" value={form.ownerEmail} onChange={set('ownerEmail')} placeholder="they'll get an invite" /></div>
          <div className="sm:col-span-2"><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Creating…' : 'Create & send invite'}</button></div>
        </form>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, ID or owner email…" className="input !pl-9" />
        </div>
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5">
          {SORTS.map(s => (
            <button key={s.key} onClick={() => setSort(s.key)} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${sort === s.key ? 'bg-card text-ink shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>{s.label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={5} cols={7} /></div>
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center"><Building2 size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">{query ? 'No workspaces match your search.' : 'No workspaces yet.'}</p></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-page/50 border-b border-divider text-left">
                {['Workspace', 'Owner', 'Members', 'Releases', 'Ledger', 'Last active', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {shown.map(w => {
                const num = (n) => <span className={n > 0 ? 'text-ink font-medium tabular-nums' : 'text-gray-300 tabular-nums'}>{n ?? 0}</span>
                return (
                <tr key={w.id} className="group hover:bg-brand-50/40 cursor-pointer transition-colors" onClick={() => setDrawerId(w.id)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {w.logo_url ? (
                        <img src={w.logo_url} alt="" className="w-9 h-9 rounded-xl object-contain bg-gray-100 flex-shrink-0 ring-1 ring-black/5 p-0.5" />
                      ) : (
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-black/5" style={{ background: w.accent_color || '#4F46E5' }}>
                          <span className="text-white font-bold text-sm">{w.name?.charAt(0)?.toUpperCase()}</span>
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-ink truncate">{w.name}</p>
                        <span className="text-[10px] text-gray-400 font-mono bg-gray-100 rounded px-1.5 py-0.5">{w.slug}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500"><span className="truncate block max-w-[180px]">{w.owner?.email || <span className="text-gray-300">no owner</span>}</span></td>
                  <td className="px-4 py-3">{num(w.members)}</td>
                  <td className="px-4 py-3">{num(w.releases)}</td>
                  <td className="px-4 py-3">{num(w.ledger_entries)}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtAgo(w.last_active)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${w.status === 'suspended' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${w.status === 'suspended' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                      {w.status === 'suspended' ? 'Suspended' : 'Active'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setDrawerId(w.id)} className="text-xs font-semibold text-gray-500 hover:text-gray-900 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">Details</button>
                      <button onClick={() => enter(w)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 border border-brand-200 hover:bg-brand-600 hover:text-white hover:border-brand-600 px-2.5 py-1 rounded-lg transition-colors"><LogIn size={13} /> Enter</button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-divider text-[11px] text-gray-400">
            <span>{shown.length} of {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}</span>
            <span>{summary.members} members · {summary.releases} releases across the platform</span>
          </div>
        </div>
      )}

      {drawerId && (
        <WorkspaceDrawer
          workspaceId={drawerId}
          isOwner={isOwner}
          onClose={() => setDrawerId(null)}
          onEnter={(label) => enter(label)}
          onChanged={load}
        />
      )}
    </div>
  )
}

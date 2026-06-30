import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, Users, Music, Disc3, TrendingUp, FileText, BookOpen, Plus, ArrowRight, LogIn } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

const fmtAgo = (d) => {
  if (!d) return 'never'
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`
  return new Date(d).toLocaleDateString()
}

const CARDS = [
  { key: 'workspaces', label: 'Workspaces', icon: Building2 },
  { key: 'members', label: 'Members', icon: Users },
  { key: 'releases', label: 'Releases', icon: Music },
  { key: 'artists', label: 'Artists', icon: Disc3 },
  { key: 'deals', label: 'Deals', icon: TrendingUp },
  { key: 'contracts', label: 'Contracts', icon: FileText },
  { key: 'ledger_entries', label: 'Ledger entries', icon: BookOpen },
  { key: 'new_30d', label: 'New (30d)', icon: Plus },
]

export default function PlatformOverview() {
  const { toast } = useToast()
  const { user, enterWorkspace } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/platform/overview').then(r => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const enter = async (id) => {
    const result = await enterWorkspace(id)
    if (result.success) navigate('/')
    else toast(result.error || 'Could not enter workspace', 'error')
  }

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>

  const t = data?.totals || {}

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name?.split(' ')[0] || 'operator'}`}
        subtitle="Platform overview across every workspace"
        action={<Link to="/workspaces" className="btn-primary"><Building2 size={16} /> Manage workspaces</Link>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {CARDS.map(c => {
          const Icon = c.icon
          return (
            <div key={c.key} className="card p-4">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><Icon size={12} /> {c.label}</div>
              <p className="text-2xl font-bold text-ink">{t[c.key] ?? 0}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Newest workspaces */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-ink">Newest workspaces</h2>
            <Link to="/workspaces" className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">All <ArrowRight size={12} /></Link>
          </div>
          <div className="space-y-2">
            {(data?.newestWorkspaces || []).map(w => (
              <div key={w.id} className="card p-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center flex-shrink-0"><span className="text-white font-bold text-xs">{w.name?.charAt(0)?.toUpperCase()}</span></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{w.name}</p>
                  <p className="text-[11px] text-gray-400">{w.members} member{w.members === 1 ? '' : 's'} · created {new Date(w.created_at).toLocaleDateString()}</p>
                </div>
                {w.status === 'suspended' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Suspended</span>}
                <button onClick={() => enter(w.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"><LogIn size={12} /> Enter</button>
              </div>
            ))}
            {!data?.newestWorkspaces?.length && <div className="card p-6 text-center"><p className="text-sm text-gray-400">No workspaces yet.</p></div>}
          </div>
        </div>

        {/* Recent activity (cross-tenant) */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-ink">Recent activity</h2>
            <Link to="/activity" className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">All <ArrowRight size={12} /></Link>
          </div>
          <div className="card divide-y divide-divider">
            {(data?.recentActivity || []).slice(0, 12).map((a, i) => (
              <div key={i} className="px-4 py-2.5">
                <p className="text-sm text-ink">{a.action}{a.detail ? <span className="text-gray-400"> — {a.detail}</span> : ''}</p>
                <p className="text-[11px] text-gray-400"><span className="font-medium text-gray-500">{a.workspace}</span> · {a.user_name || 'System'} · {fmtAgo(a.created_at)}</p>
              </div>
            ))}
            {!data?.recentActivity?.length && <div className="px-4 py-6 text-center"><p className="text-sm text-gray-400">No activity yet.</p></div>}
          </div>
        </div>
      </div>
    </div>
  )
}

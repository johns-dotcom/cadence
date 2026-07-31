import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, Disc3, TrendingUp, ArrowRight, LogIn, Ban } from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
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
const num = (n) => Number(n || 0).toLocaleString()

// The operator's own sign-ins / workspace entries are self-noise on the
// at-a-glance overview — filtered out here (still visible on the full feed).
const NOISE = /signed in|workspace entered/i

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

  const t = data?.totals || {}
  const activity = (data?.recentActivity || []).filter(a => !NOISE.test(a.action || '')).slice(0, 7)

  return (
    <div className="space-y-6">
      {/* Hero band */}
      <div className="rounded-2xl p-6 sm:p-7 text-white relative overflow-hidden" style={{ background: 'linear-gradient(120deg,#0f172a 0%, #1e1b4b 55%, rgb(var(--color-brand-700)) 130%)' }}>
        <div className="absolute -right-8 -top-10 opacity-10"><Disc3 size={180} /></div>
        <div className="relative">
          <p className="text-sm text-white/70">Welcome back, {user?.name?.split(' ')[0] || 'operator'}</p>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mt-3">
            <div>
              <p className="text-4xl font-bold leading-none">{loading ? '—' : num(t.active)}</p>
              <p className="text-xs text-white/60 mt-1.5">Active workspaces</p>
            </div>
            <div className="h-9 w-px bg-white/15 hidden sm:block" />
            <div><p className="text-2xl font-semibold leading-none">{loading ? '—' : num(t.members)}</p><p className="text-xs text-white/60 mt-1.5">Members</p></div>
            <div className="flex items-center gap-2">
              {t.new_30d > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold bg-white/10 rounded-full px-2.5 py-1"><TrendingUp size={12} /> +{t.new_30d} this month</span>
              )}
              {t.suspended > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/10 rounded-full px-2.5 py-1"><Ban size={12} /> {t.suspended} suspended</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 mt-5">
            <Link to="/workspaces" className="inline-flex items-center gap-1.5 text-sm font-semibold bg-white text-gray-900 px-3.5 py-2 rounded-lg hover:bg-white/90 transition"><Building2 size={15} /> Manage workspaces</Link>
          </div>
        </div>
      </div>

      {/* Rails */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-ink">Newest workspaces</h2>
            <Link to="/workspaces" className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">All <ArrowRight size={12} /></Link>
          </div>
          <div className="space-y-2">
            {loading ? <Skeleton.TaskList count={4} /> : (data?.newestWorkspaces || []).map(w => (
              <div key={w.id} className="card p-3 flex items-center gap-3 group hover:border-brand-300 transition-colors">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#111827,rgb(var(--color-brand-600)))' }}><span className="text-white font-bold text-xs">{w.name?.charAt(0)?.toUpperCase()}</span></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{w.name}</p>
                  <p className="text-[11px] text-gray-400">{w.members} member{w.members === 1 ? '' : 's'} · created {new Date(w.created_at).toLocaleDateString()}</p>
                </div>
                {w.status === 'suspended' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Suspended</span>}
                <button onClick={() => enter(w.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 opacity-0 group-hover:opacity-100 transition"><LogIn size={12} /> Enter</button>
              </div>
            ))}
            {!loading && !data?.newestWorkspaces?.length && <div className="card p-6 text-center"><p className="text-sm text-gray-400">No workspaces yet.</p></div>}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-ink">Recent activity</h2>
            <Link to="/activity" className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">All <ArrowRight size={12} /></Link>
          </div>
          <div className="card divide-y divide-divider">
            {loading ? <div className="p-4"><Skeleton.TaskList count={6} /></div> : activity.map((a, i) => (
              <div key={i} className="px-4 py-2.5">
                <p className="text-sm text-ink">{a.action}{a.detail ? <span className="text-gray-400"> — {a.detail}</span> : ''}</p>
                <p className="text-[11px] text-gray-400"><span className="font-medium text-gray-500">{a.workspace}</span> · {a.user_name || 'System'} · {fmtAgo(a.created_at)}</p>
              </div>
            ))}
            {!loading && !activity.length && <div className="px-4 py-6 text-center"><p className="text-sm text-gray-400">Nothing notable yet.</p></div>}
          </div>
        </div>
      </div>
    </div>
  )
}

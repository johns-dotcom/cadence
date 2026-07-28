import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, Users, Music, Disc3, TrendingUp, FileText, BookOpen, Plus, ArrowRight, LogIn, Ban } from 'lucide-react'
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
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

const CARDS = [
  { key: 'members', label: 'Members', icon: Users },
  { key: 'releases', label: 'Releases', icon: Music },
  { key: 'artists', label: 'Artists', icon: Disc3 },
  { key: 'deals', label: 'Deals', icon: TrendingUp },
  { key: 'contracts', label: 'Contracts', icon: FileText },
  { key: 'ledger_entries', label: 'Ledger entries', icon: BookOpen },
]

export default function PlatformOverview() {
  const { toast } = useToast()
  const { user, enterWorkspace } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/platform/overview').then(r => setData(r.data.data)).catch(() => {}),
      api.get('/platform/analytics').then(r => {
        const map = Object.fromEntries((r.data.data?.workspacesByMonth || []).map(m => [m.month, m.n]))
        const out = []
        const now = new Date()
        for (let i = 11; i >= 0; i--) {
          const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
          out.push({ month: key.slice(2), n: map[key] || 0 })
        }
        setSeries(out)
      }).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  const enter = async (id) => {
    const result = await enterWorkspace(id)
    if (result.success) navigate('/')
    else toast(result.error || 'Could not enter workspace', 'error')
  }

  const t = data?.totals || {}

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
            <div><p className="text-2xl font-semibold leading-none">${loading ? '—' : num(t.mrr)}</p><p className="text-xs text-white/60 mt-1.5">MRR</p></div>
            <div><p className="text-2xl font-semibold leading-none">{loading ? '—' : num(t.members)}</p><p className="text-xs text-white/60 mt-1.5">Members</p></div>
            <div><p className="text-2xl font-semibold leading-none">{loading ? '—' : num(t.releases)}</p><p className="text-xs text-white/60 mt-1.5">Releases</p></div>
            {t.suspended > 0 && (
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/10 rounded-full px-2.5 py-1"><Ban size={12} /> {t.suspended} suspended</div>
            )}
          </div>
          <div className="flex items-center gap-2 mt-5">
            <Link to="/workspaces" className="inline-flex items-center gap-1.5 text-sm font-semibold bg-white text-gray-900 px-3.5 py-2 rounded-lg hover:bg-white/90 transition"><Building2 size={15} /> Manage workspaces</Link>
            <Link to="/analytics" className="inline-flex items-center gap-1.5 text-sm font-semibold bg-white/10 text-white px-3.5 py-2 rounded-lg hover:bg-white/20 transition">Analytics <ArrowRight size={14} /></Link>
          </div>
        </div>
      </div>

      {/* KPI cards + growth chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {/* Workspaces card carries the 30-day growth signal */}
          <div className="card p-4">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><Building2 size={12} /> Workspaces</div>
            <p className="text-2xl font-bold text-ink">{loading ? '—' : num(t.workspaces)}</p>
            {t.new_30d > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600 mt-1"><TrendingUp size={11} /> +{t.new_30d} this month</span>}
          </div>
          {CARDS.map(c => {
            const Icon = c.icon
            return (
              <div key={c.key} className="card p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><Icon size={12} /> {c.label}</div>
                <p className="text-2xl font-bold text-ink">{loading ? '—' : num(t[c.key])}</p>
              </div>
            )
          })}
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-ink">Workspace growth</h2>
            <span className="text-[11px] text-gray-400">12 mo</span>
          </div>
          {loading ? <Skeleton.Block h="h-40" /> : (
            <div style={{ height: 168 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pw" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="rgb(var(--color-brand-500))" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="rgb(var(--color-brand-500))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-gray-200))" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={1} />
                  <Tooltip />
                  <Area type="monotone" dataKey="n" name="New workspaces" stroke="rgb(var(--color-brand-500))" fill="url(#pw)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
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
            {loading ? <div className="p-4"><Skeleton.TaskList count={6} /></div> : (data?.recentActivity || []).slice(0, 12).map((a, i) => (
              <div key={i} className="px-4 py-2.5">
                <p className="text-sm text-ink">{a.action}{a.detail ? <span className="text-gray-400"> — {a.detail}</span> : ''}</p>
                <p className="text-[11px] text-gray-400"><span className="font-medium text-gray-500">{a.workspace}</span> · {a.user_name || 'System'} · {fmtAgo(a.created_at)}</p>
              </div>
            ))}
            {!loading && !data?.recentActivity?.length && <div className="px-4 py-6 text-center"><p className="text-sm text-gray-400">No activity yet.</p></div>}
          </div>
        </div>
      </div>
    </div>
  )
}

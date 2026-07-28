import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LogIn, Users, ShieldAlert, DoorOpen, Moon } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'

const fmt = (d) => d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const fmtAgo = (d) => {
  if (!d) return 'never'
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`
  return new Date(d).toLocaleDateString()
}

const STATS = [
  { key: 'logins_24h', label: 'Logins (24h)', icon: LogIn },
  { key: 'logins_7d', label: 'Logins (7d)', icon: LogIn },
  { key: 'active_users_7d', label: 'Active users (7d)', icon: Users },
  { key: 'operator_entries_7d', label: 'Operator entries (7d)', icon: DoorOpen },
]

export default function PlatformSecurity() {
  const [data, setData] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('logins') // 'logins' | 'operators'

  useEffect(() => {
    Promise.all([
      api.get('/platform/security').then(r => setData(r.data.data)).catch(() => {}),
      api.get('/platform/enter-sessions').then(r => setSessions(r.data.data || [])).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  const s = data?.stats || {}

  return (
    <div>
      <PageHeader title="Security" subtitle="Login audit and operator access across every workspace" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {STATS.map(({ key, label, icon: Icon }) => (
          <div key={key} className="card p-4">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><Icon size={12} /> {label}</div>
            <p className="text-2xl font-bold text-ink">{loading ? '—' : (s[key] ?? 0).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Login / operator feed */}
        <div className="lg:col-span-2">
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5 mb-3 w-fit">
            <button onClick={() => setView('logins')} className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${view === 'logins' ? 'bg-card text-ink shadow-sm' : 'text-gray-500'}`}>User logins</button>
            <button onClick={() => setView('operators')} className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${view === 'operators' ? 'bg-card text-ink shadow-sm' : 'text-gray-500'}`}>Operator entries</button>
          </div>

          {loading ? (
            <div className="card p-2"><Skeleton.Table rows={8} cols={4} /></div>
          ) : view === 'logins' ? (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-divider text-left text-[10px] text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Workspace</th>
                    <th className="px-4 py-3 font-semibold">IP</th>
                    <th className="px-4 py-3 font-semibold">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {data?.recentLogins?.length ? data.recentLogins.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-ink flex items-center gap-1.5">{r.name}{r.is_operator && <span className="text-[9px] font-bold uppercase bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded">Operator</span>}</p>
                        <p className="text-[11px] text-gray-400">{r.email}</p>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.workspace || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400 font-mono text-xs whitespace-nowrap">{r.ip_address || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{fmt(r.logged_in_at)}</td>
                    </tr>
                  )) : <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No logins recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-divider text-left text-[10px] text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3 font-semibold">Operator</th>
                    <th className="px-4 py-3 font-semibold">Entered workspace</th>
                    <th className="px-4 py-3 font-semibold">IP</th>
                    <th className="px-4 py-3 font-semibold">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {sessions.length ? sessions.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-ink">{r.operator_name || '—'}</p>
                        <p className="text-[11px] text-gray-400">{r.operator_email}</p>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.workspace || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400 font-mono text-xs whitespace-nowrap">{r.ip_address || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{fmt(r.created_at)}</td>
                    </tr>
                  )) : <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No operator entries recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Dormant workspaces */}
        <div>
          <h2 className="text-sm font-bold text-ink mb-3 inline-flex items-center gap-1.5"><Moon size={14} /> Dormant workspaces</h2>
          {loading ? <Skeleton.TaskList count={5} /> : data?.dormant?.length ? (
            <div className="space-y-2">
              {data.dormant.map(w => (
                <div key={w.id} className="card p-3 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${w.last_login ? 'bg-amber-400' : 'bg-red-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{w.name}</p>
                    <p className="text-[11px] text-gray-400">{w.members} member{w.members === 1 ? '' : 's'} · last login {fmtAgo(w.last_login)}</p>
                  </div>
                  {w.status === 'suspended' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Suspended</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-6 text-center"><ShieldAlert size={22} className="text-gray-300 mx-auto mb-2" /><p className="text-sm text-gray-400">Every workspace has logged in within 30 days.</p></div>
          )}
        </div>
      </div>
    </div>
  )
}

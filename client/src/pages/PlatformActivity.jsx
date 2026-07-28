import { useEffect, useState } from 'react'
import { Search, ScrollText } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'

const fmt = (d) => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function PlatformActivity() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [workspaces, setWorkspaces] = useState([])
  const [labelId, setLabelId] = useState('')

  const load = () => {
    setLoading(true)
    const params = {}
    if (q.trim()) params.q = q.trim()
    if (labelId) params.label_id = labelId
    api.get('/platform/activity', { params }).then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { api.get('/platform/workspaces').then(r => setWorkspaces(r.data.data || [])).catch(() => {}) }, [])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [q, labelId])

  return (
    <div>
      <PageHeader title="Activity" subtitle="Cross-tenant audit feed across every workspace" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search actions…" className="input !pl-9" />
        </div>
        <select value={labelId} onChange={e => setLabelId(e.target.value)} className="input !w-auto">
          <option value="">All workspaces</option>
          {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      {!loading && rows.length > 0 && <p className="text-[11px] text-gray-400 mb-2">{rows.length} event{rows.length === 1 ? '' : 's'}</p>}

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={8} cols={4} /></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center"><ScrollText size={26} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No activity.</p></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left text-[10px] text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Workspace</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {rows.map((a, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-ink whitespace-nowrap">{a.workspace}</td>
                  <td className="px-4 py-2.5 text-gray-700">{a.action}{a.detail ? <span className="text-gray-400"> — {a.detail}</span> : ''}</td>
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{a.user_name || 'System'}</td>
                  <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{fmt(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import api from '../api'
import PageHeader from '../components/PageHeader'

export default function Activity() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/activity').then(res => setRows(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <PageHeader title="Activity" subtitle="Audit trail for this workspace" />
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center"><p className="text-sm text-gray-500">No activity recorded yet.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">When</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">User</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Action</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-ink">{r.user_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.action}</td>
                  <td className="px-4 py-3 text-gray-400">{r.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

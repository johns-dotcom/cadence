import { useEffect, useState } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'

// Days-until-expiry → urgency styling.
function urgency(date) {
  const days = Math.ceil((new Date(date) - new Date()) / 86400000)
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, cls: 'bg-red-100 text-red-700' }
  if (days <= 30) return { label: `${days}d left`, cls: 'bg-red-100 text-red-700' }
  if (days <= 60) return { label: `${days}d left`, cls: 'bg-amber-100 text-amber-700' }
  return { label: `${days}d left`, cls: 'bg-gray-100 text-gray-600' }
}

export default function Renewals() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(90)

  const load = (d) => {
    setLoading(true)
    api.get(`/contracts/renewals?days=${d}`).then(res => setRows(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => load(days), [days])

  return (
    <div>
      <PageHeader
        title="Renewals"
        subtitle="Active contracts expiring soon"
        action={
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="input w-auto">
            <option value={30}>Next 30 days</option>
            <option value={60}>Next 60 days</option>
            <option value={90}>Next 90 days</option>
            <option value={180}>Next 180 days</option>
          </select>
        }
      />

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <RefreshCw size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Nothing expiring in this window. 🎉</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Artist</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Expires</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Countdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {rows.map(c => {
                const u = urgency(c.expiration_date)
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-ink">{c.artist_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{c.type}</td>
                    <td className="px-4 py-3 text-gray-600">{new Date(c.expiration_date).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${u.cls}`}>
                        <AlertTriangle size={11} /> {u.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

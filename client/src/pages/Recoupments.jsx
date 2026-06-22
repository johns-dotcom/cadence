import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import PageHeader from '../components/PageHeader'

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function Recoupments() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/financials/recoupments').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  // Only show artists with financial activity.
  const active = rows.filter(r => r.recoupable_spend > 0 || r.income > 0)

  return (
    <div>
      <PageHeader title="Recoupments" subtitle="Recoupable spend vs. income, per artist" />
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : active.length === 0 ? (
        <div className="card p-10 text-center"><p className="text-sm text-gray-500">No recoupable activity yet. Mark ledger entries as recoupable and record artist income to see balances here.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider bg-page/50">
                <th className="px-4 py-2.5 font-semibold">Artist</th>
                <th className="px-4 py-2.5 font-semibold text-right">Recoupable spend</th>
                <th className="px-4 py-2.5 font-semibold text-right">Income</th>
                <th className="px-4 py-2.5 font-semibold text-right">Balance</th>
                <th className="px-4 py-2.5 font-semibold text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {active.map(r => (
                <tr key={r.artist_id} className="border-b border-divider last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3"><Link to={`/artists/${r.artist_id}`} className="font-medium text-ink hover:text-brand-600">{r.name}</Link></td>
                  <td className="px-4 py-3 text-right text-red-600">{money(r.recoupable_spend)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{money(r.income)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${r.balance >= 0 ? 'text-ink' : 'text-red-600'}`}>{money(r.balance)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.recouped ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {r.recouped ? 'Recouped' : 'Unrecouped'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Clock, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { formatDate, daysUntilLocal } from '../utils/dates'

// Days until a contract expires, on the LOCAL calendar. Never
// `new Date('YYYY-MM-DD') - new Date()`: that parses the DB date as
// UTC-midnight and diffs it against wall-clock time, so a contract expiring
// tomorrow reads "2 days" for most of the day west of UTC and the urgency
// bands slide with the viewer's timezone. daysUntilLocal compares calendar
// days, so "expires today" is always 0 and "expired yesterday" is always -1.
const daysLeftOf = (expirationDate) => daysUntilLocal(expirationDate) ?? 0

// Four urgency bands, keyed off that local day count. `>= 90` is a POSITIVE
// state (comfortably active) and must stay visually distinct from the neutral
// "no signal" gray used for expired rows.
function bandOf(daysLeft) {
  if (daysLeft < 0) return 'expired'
  if (daysLeft < 30) return 'soon'
  if (daysLeft < 90) return 'ninety'
  return 'active'
}
const BAND_BADGE = {
  expired: 'bg-gray-100 text-ink-muted',
  soon:    'bg-[rgba(239,68,68,0.10)] text-danger',
  ninety:  'bg-[rgba(245,158,11,0.12)] text-warning',
  active:  'bg-[rgba(16,185,129,0.12)] text-success',
}
const BAND_LABEL = { expired: 'Expired', soon: 'Expiring Soon', ninety: '90 Days', active: 'Active' }
const BAND_DAYS_COLOR = {
  expired: 'text-ink-faint',
  soon:    'text-danger',
  ninety:  'text-warning',
  active:  'text-success',
}

const FILTERS = ['All', 'Expiring Soon', 'Active', 'Expired']

// Contract renewal portfolio — every contract carrying an expiration date,
// banded by how far out it sits. The server returns the whole set unfiltered
// so Expired and long-Active contracts stay reachable here.
export default function Renewals() {
  const [renewals, setRenewals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('All')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/contracts/renewals')
      setRenewals(res.data.data || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load renewals')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // One pass: band every row once so the cards, the pill counts and the table
  // can never disagree about which bucket a contract is in.
  const banded = useMemo(
    () => renewals.map(c => {
      const daysLeft = daysLeftOf(c.expiration_date)
      return { ...c, daysLeft, band: bandOf(daysLeft) }
    }),
    [renewals],
  )
  const counts = useMemo(() => {
    const c = { expired: 0, soon: 0, ninety: 0, active: 0 }
    for (const r of banded) c[r.band] += 1
    return c
  }, [banded])

  // "Active" spans both the 90-day and the comfortable band (>= 30 days out),
  // matching the pill semantics: it means "not expiring soon, not expired".
  const activeCount = counts.ninety + counts.active
  const filterCount = { 'All': banded.length, 'Expiring Soon': counts.soon, 'Active': activeCount, 'Expired': counts.expired }

  const shown = banded.filter(r => {
    if (filter === 'All') return true
    if (filter === 'Expiring Soon') return r.band === 'soon'
    if (filter === 'Active') return r.band === 'ninety' || r.band === 'active'
    if (filter === 'Expired') return r.band === 'expired'
    return true
  })

  const statCards = [
    { label: 'Total Contracts', value: banded.length, icon: Clock, color: 'text-ink-muted', tile: 'bg-gray-100' },
    { label: 'Expiring Soon', value: counts.soon, icon: AlertTriangle, color: 'text-danger', tile: 'bg-[rgba(239,68,68,0.10)]' },
    { label: '90 Days', value: counts.ninety, icon: Clock, color: 'text-warning', tile: 'bg-[rgba(245,158,11,0.12)]' },
    { label: 'Active', value: activeCount, icon: CheckCircle2, color: 'text-success', tile: 'bg-[rgba(16,185,129,0.12)]' },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton.PageHeader />
        <Skeleton.StatCards count={4} />
        <div className="card overflow-hidden"><Skeleton.Table rows={6} cols={6} /></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Contract Renewals" subtitle="Track your contract expiration dates" />

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] text-danger text-sm">
          <span>{error}</span>
          <button onClick={load} className="btn-secondary text-xs">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, tile }) => (
          <div key={label} className="card px-5 py-4 flex items-center gap-4">
            <div className={`w-10 h-10 ${tile} rounded-lg flex items-center justify-center flex-shrink-0`}>
              <Icon size={20} className={color} strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm text-ink-muted font-medium">{label}</p>
              <p className="text-2xl font-semibold text-ink mt-0.5 tabular-nums">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map(key => (
          <button key={key} onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
              filter === key ? 'bg-brand-600 text-white' : 'bg-card border border-rule text-ink-muted hover:bg-gray-50'
            }`}>
            {key} ({filterCount[key]})
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] text-ink-muted uppercase tracking-wide border-b border-divider bg-elev">
                <th className="px-4 py-2.5 font-semibold">Artist</th>
                <th className="px-4 py-2.5 font-semibold">Type</th>
                <th className="px-4 py-2.5 font-semibold">Territory</th>
                <th className="px-4 py-2.5 font-semibold">Expires</th>
                <th className="px-4 py-2.5 font-semibold">Days Left</th>
                <th className="px-4 py-2.5 font-semibold">Royalty</th>
                <th className="px-4 py-2.5 font-semibold">Advance</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {shown.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-4 py-12 text-center">
                    <RefreshCw size={26} className="text-ink-faint mx-auto mb-3" />
                    <p className="text-sm text-ink-muted">No renewals found</p>
                  </td>
                </tr>
              ) : shown.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-ink">{c.artist_name || '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">{c.type || '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">{c.territory || '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">{formatDate(c.expiration_date)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-sm font-semibold tabular-nums ${BAND_DAYS_COLOR[c.band]}`}>
                      {c.daysLeft < 0 ? 'Expired' : `${c.daysLeft}d`}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink font-medium tabular-nums">
                    {c.royalty_split == null || c.royalty_split === '' ? '—' : `${c.royalty_split}%`}
                  </td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">
                    {c.advance == null || c.advance === '' ? '—' : `$${Number(c.advance).toLocaleString()}`}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${BAND_BADGE[c.band]}`}>
                      {BAND_LABEL[c.band]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

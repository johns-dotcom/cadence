import { useEffect, useState } from 'react'
import { Users, Music, CalendarClock, UserCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import PageHeader from '../components/PageHeader'

const STAT_CARDS = [
  { key: 'artists',  label: 'Artists',          icon: Users },
  { key: 'releases', label: 'Releases',         icon: Music },
  { key: 'upcoming', label: 'Upcoming',         icon: CalendarClock },
  { key: 'members',  label: 'Team members',     icon: UserCheck },
]

export default function Dashboard() {
  const { user, label } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/dashboard')
      .then(res => setData(res.data.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <PageHeader
        title={`Welcome${user?.name ? `, ${user.name.split(' ')[0]}` : ''}`}
        subtitle={label?.name ? `${label.name} · label operations` : 'Label operations'}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {STAT_CARDS.map(({ key, label, icon: Icon }) => (
          <div key={key} className="card p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
              <Icon size={16} className="text-gray-400" />
            </div>
            <p className="text-3xl font-bold text-ink mt-2">
              {loading ? '—' : (data?.stats?.[key] ?? 0)}
            </p>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-bold text-ink mb-4">Recent activity</h2>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : data?.recentActivity?.length ? (
          <ul className="divide-y divide-divider">
            {data.recentActivity.map(a => (
              <li key={a.id} className="py-2.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-ink truncate">
                    <span className="font-medium">{a.user_name || 'Someone'}</span>{' '}
                    <span className="text-gray-500">{a.action}</span>
                    {a.detail && <span className="text-gray-400"> — {a.detail}</span>}
                  </p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {new Date(a.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">No activity yet. Add an artist or release to get started.</p>
        )}
      </div>
    </div>
  )
}

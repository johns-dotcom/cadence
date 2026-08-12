// The approver "Waiting on you" rail, lifted out of MyWork.jsx unchanged.
// Personal by definition, so it renders on /my-work only — never on Team Work.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Inbox, Stamp } from 'lucide-react'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import { dueBucketOf, isOpen } from './taskFields'

export default function WaitingOnYou({ tasks }) {
  const { user } = useAuth()
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)
  const [pending, setPending] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)

  useEffect(() => {
    if (!isApprover) return
    api.get('/dashboard/widgets').then(r => setPending(r.data.data?.pendingApprovals || 0)).catch(() => {})
    api.get('/artist-campaigns/review-inbox').then(r => setReviewCount((r.data.data || []).length)).catch(() => {})
  }, [isApprover])

  // Same dueBucketOf the board uses, so this count always matches the Overdue group.
  const overdue = tasks.filter(t => isOpen(t) && dueBucketOf(t) === 'overdue').length

  if (!isApprover || (overdue === 0 && reviewCount === 0 && pending === 0)) return null

  return (
    <div className="mb-6">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Waiting on you</p>
      {/* Horizontal strip on phones, tiles from sm up. */}
      <div className="flex gap-3 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0 sm:grid sm:grid-cols-3">
        {overdue > 0 && (
          <div className="card p-4 flex items-center gap-3 border-l-4 border-l-red-500 min-w-[13rem] sm:min-w-0">
            <AlertTriangle size={20} className="text-red-500 flex-shrink-0" />
            <div><p className="text-lg font-bold text-ink leading-none">{overdue}</p><p className="text-xs text-gray-500 mt-1">Overdue task{overdue === 1 ? '' : 's'}</p></div>
          </div>
        )}
        {pending > 0 && (
          <Link to="/approvals" className="card p-4 flex items-center gap-3 border-l-4 border-l-amber-500 hover:bg-gray-50 transition min-w-[13rem] sm:min-w-0">
            <Stamp size={20} className="text-amber-500 flex-shrink-0" />
            <div><p className="text-lg font-bold text-ink leading-none">{pending}</p><p className="text-xs text-gray-500 mt-1">Awaiting your approval</p></div>
          </Link>
        )}
        {reviewCount > 0 && (
          <Link to="/artist-campaigns" className="card p-4 flex items-center gap-3 border-l-4 border-l-brand-500 hover:bg-gray-50 transition min-w-[13rem] sm:min-w-0">
            <Inbox size={20} className="text-brand-500 flex-shrink-0" />
            <div><p className="text-lg font-bold text-ink leading-none">{reviewCount}</p><p className="text-xs text-gray-500 mt-1">Campaign{reviewCount === 1 ? '' : 's'} to review</p></div>
          </Link>
        )}
      </div>
    </div>
  )
}

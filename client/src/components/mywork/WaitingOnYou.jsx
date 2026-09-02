// The "Waiting on you" rail on /my-work. Personal by definition, so it renders on
// /my-work only — never on Team Work.
//
// It used to be three count tiles shown ONLY to Approvers, which meant the rail a
// plain User saw was nothing at all: their overdue count, their unread @mentions and
// their due reminders were all things this rail exists to surface, and none of them
// are privileged. The approval and campaign-review tiles are the privileged pair, so
// those alone stay gated — everything else is now everybody's.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, AtSign, Bell, CalendarClock, Inbox, Stamp } from 'lucide-react'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import { localDateStr } from '../../utils/dates'
import { dueBucketOf, isOpen } from './taskFields'

function Tile({ to, icon: Icon, accent, iconClass, count, label, children }) {
  const inner = (
    <>
      <Icon size={20} className={`${iconClass} flex-shrink-0`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-lg font-bold text-ink leading-none">{count}</p>
        <p className="text-[11px] text-ink-muted mt-1">{label}</p>
        {children}
      </div>
    </>
  )
  const cls = `card p-4 flex items-center gap-3 border-l-4 ${accent} min-w-[13rem] sm:min-w-0`
  return to
    ? <Link to={to} className={`${cls} hover:bg-elev transition`}>{inner}</Link>
    : <div className={cls}>{inner}</div>
}

export default function WaitingOnYou({ tasks, onBulkPatch }) {
  const { user } = useAuth()
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)
  const [pending, setPending] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  const [mentions, setMentions] = useState([])
  const [reminders, setReminders] = useState([])
  const [rescheduling, setRescheduling] = useState(false)

  const loadPersonal = useCallback(() => {
    // One call covers mentions AND due reminders; /notifications already scopes
    // both to the caller and role-gates the privileged rows internally.
    api.get('/notifications')
      .then(r => {
        const d = r.data.data || {}
        setMentions(d.mentions || [])
        setReminders((d.smart_alerts || []).filter(a => a.type === 'reminder'))
      })
      .catch(() => {})
  }, [])

  useEffect(() => { loadPersonal() }, [loadPersonal])

  useEffect(() => {
    if (!isApprover) return
    api.get('/dashboard/widgets').then(r => setPending(r.data.data?.pendingApprovals || 0)).catch(() => {})
    api.get('/artist-campaigns/review-inbox').then(r => setReviewCount((r.data.data || []).length)).catch(() => {})
  }, [isApprover])

  // Same dueBucketOf the board uses, so this count always matches the Overdue group.
  const overdueTasks = tasks.filter(t => isOpen(t) && dueBucketOf(t) === 'overdue')
  const overdue = overdueTasks.length

  // boom's rollover banner: one click to pull everything late onto today. Goes
  // through the caller's bulk patch (one request, server-side permission gate in
  // the WHERE) rather than N sequential PATCHes.
  const rescheduleOverdue = async () => {
    if (!onBulkPatch || rescheduling || !overdue) return
    setRescheduling(true)
    await onBulkPatch(overdueTasks.map(t => t.id), { due_date: localDateStr() })
    setRescheduling(false)
  }

  const dismissMention = (id) => {
    setMentions(ms => ms.filter(m => m.id !== id && m.mentionId !== id))
    api.post('/notifications/mentions/read', { id }).catch(() => {})
  }

  const nothing = overdue === 0 && reviewCount === 0 && pending === 0 && !mentions.length && !reminders.length
  if (nothing) return null

  return (
    <div className="mb-6">
      <h2 className="text-xs font-bold text-ink-muted uppercase tracking-wide mb-2">Waiting on you</h2>

      {/* Horizontal strip on phones, tiles from sm up. */}
      <div className="flex gap-3 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0 sm:grid sm:grid-cols-2 lg:grid-cols-4">
        {overdue > 0 && (
          <Tile icon={AlertTriangle} accent="border-l-red-500" iconClass="text-red-500" count={overdue}
            label={`Overdue task${overdue === 1 ? '' : 's'}`}>
            {onBulkPatch && (
              <button
                onClick={rescheduleOverdue}
                disabled={rescheduling}
                className="mt-1 text-[10px] font-semibold text-brand-ink hover:underline disabled:opacity-60 rounded
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {rescheduling ? 'Rescheduling…' : 'Reschedule all → today'}
              </button>
            )}
          </Tile>
        )}

        {mentions.length > 0 && (
          <Tile icon={AtSign} accent="border-l-violet-500" iconClass="text-violet-500"
            count={mentions.length} label={`Unread mention${mentions.length === 1 ? '' : 's'}`} />
        )}

        {reminders.length > 0 && (
          <Tile to="/bank-statements" icon={CalendarClock} accent="border-l-sky-500" iconClass="text-sky-500"
            count={reminders.length} label={`Reminder${reminders.length === 1 ? '' : 's'} due`} />
        )}

        {pending > 0 && (
          <Tile to="/approvals" icon={Stamp} accent="border-l-amber-500" iconClass="text-amber-500"
            count={pending} label="Awaiting your approval" />
        )}

        {reviewCount > 0 && (
          <Tile to="/artist-campaigns" icon={Inbox} accent="border-l-brand-500" iconClass="text-brand-500"
            count={reviewCount} label={`Campaign${reviewCount === 1 ? '' : 's'} to review`} />
        )}
      </div>

      {/* The mention LIST, not just its count — boom showed who said what, which is
          the whole reason you'd act on it. Capped at 3; the bell owns the full set. */}
      {mentions.length > 0 && (
        <div className="card mt-3 divide-y divide-divider">
          {mentions.slice(0, 3).map(m => (
            <div key={m.key || m.mentionId} className="flex items-start gap-2 px-3 py-2">
              <AtSign size={13} className="text-violet-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <Link to={m.link || '/'} className="min-w-0 flex-1 group">
                <p className="text-[11px] font-medium text-ink group-hover:text-brand-ink">{m.title}</p>
                {m.detail && <p className="text-[11px] text-ink-muted truncate">{m.detail}</p>}
              </Link>
              <button
                onClick={() => dismissMention(m.mentionId)}
                className="text-[10px] font-semibold text-ink-faint hover:text-ink flex-shrink-0 rounded px-1
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                Mark read
              </button>
            </div>
          ))}
          {mentions.length > 3 && (
            <p className="px-3 py-1.5 text-[10px] text-ink-muted">
              +{mentions.length - 3} more <Bell size={10} className="inline" aria-hidden="true" /> in the bell
            </p>
          )}
        </div>
      )}
    </div>
  )
}

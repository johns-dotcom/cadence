import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, Music, FileText, CheckSquare, Receipt, AtSign, Package, Zap,
  Inbox, Wallet, Settings2, Check, AlarmClock, CheckCheck,
} from 'lucide-react'
import api from '../api'
import { useSocket } from '../context/SocketContext'

// Smart-alert bell. Polls /api/notifications (computed live, label-scoped) and
// shows a badge + dropdown.
//
// The dropdown renders SECTIONS, not a flat list, because the alerts are not
// interchangeable: a reminder you tick off, a mention you open, and a release
// shipping on Friday with no artwork are three different kinds of news, and a
// single undifferentiated column makes you read all of them to find the one
// that matters. Section order is fixed and runs most-actionable first.
const ICONS = {
  release: Music, release_behind: Zap, release_unassigned: Zap,
  task: CheckSquare, task_overdue: Zap,
  contract: FileText, contract_renewal: Zap,
  approval: Receipt, vendor_submission: Inbox,
  mention: AtSign, bulk_deal: Package, payment_rush: Zap,
  budget_burn: Wallet, reminder: AlarmClock,
}
const SEVERITY = {
  danger:  'text-red-600 bg-red-50',
  warning: 'text-amber-600 bg-amber-50',
  info:    'text-brand-ink bg-brand-500/10',
}

// group → { label, icon, pref }. `pref` is the preference key that hides it;
// sections with no pref key (mentions) can't be switched off.
const SECTIONS = [
  { key: 'reminders', label: 'Reminders',         icon: AlarmClock, pref: 'reminders' },
  { key: 'mentions',  label: 'Mentions',          icon: AtSign },
  { key: 'smart',     label: 'Smart alerts',      icon: Zap,        pref: 'smart' },
  { key: 'tasks',     label: 'Your tasks',        icon: CheckSquare, pref: 'tasks' },
  { key: 'releases',  label: 'Upcoming releases', icon: Music,      pref: 'releases' },
  { key: 'contracts', label: 'Expiring contracts', icon: FileText,  pref: 'contracts' },
  { key: 'vendor',    label: 'Vendor submissions', icon: Inbox,     pref: 'vendor' },
  { key: 'approvals', label: 'Awaiting approval',  icon: Receipt,   pref: 'vendor' },
  { key: 'budget',    label: 'Budget alerts',     icon: Wallet,     pref: 'budget' },
]

// Per-type preferences. Stored per browser and MERGED over defaults, so a type
// added later defaults ON instead of silently inheriting a stale `false` from
// whatever was saved months ago.
const PREF_KEY = 'cadence_notif_prefs'
const PREF_DEFAULTS = { smart: true, tasks: true, releases: true, contracts: true, vendor: true, budget: true, reminders: true }
const PREF_LABELS = {
  smart: 'Smart alerts', tasks: 'Your tasks', releases: 'Upcoming releases',
  contracts: 'Expiring contracts', vendor: 'Vendor submissions & approvals',
  budget: 'Budget alerts', reminders: 'Reminders',
}
function loadPrefs() {
  try { return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } }
  catch { return { ...PREF_DEFAULTS } }
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [showPrefs, setShowPrefs] = useState(false)
  const [prefs, setPrefs] = useState(loadPrefs)
  const ref = useRef(null)
  const navigate = useNavigate()
  const { on: onSocket } = useSocket()

  const load = () => {
    api.get('/notifications')
      .then(r => setItems(r.data.data.items || []))
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 120000) // refresh every 2 min
    return () => clearInterval(t)
  }, [])

  // A chat @mention lands instantly — refresh the bell without waiting for the poll.
  useEffect(() => onSocket('mention', () => load()), [onSocket])

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setShowPrefs(false) } }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const setPref = (k, v) => {
    const next = { ...prefs, [k]: v }
    setPrefs(next)
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  // Preferences filter what is COUNTED as well as what is shown — a badge that
  // counts alerts you have switched off is a badge you learn to ignore.
  const visible = useMemo(() => {
    const sectionFor = (i) => SECTIONS.find(s => s.key === i.group)
    return items.filter(i => {
      const sec = sectionFor(i)
      if (!sec || !sec.pref) return true
      return prefs[sec.pref] !== false
    })
  }, [items, prefs])

  const count = visible.length

  const bySection = useMemo(() => {
    const m = {}
    for (const i of visible) (m[i.group] = m[i.group] || []).push(i)
    return m
  }, [visible])

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''

  const toggleOpen = () => { setOpen(v => !v); if (!open) load() }
  // Clear-all watermarks computed alerts only; mentions are left untouched.
  const clearAll = async () => { try { await api.post('/notifications/clear'); load() } catch { /* ignore */ } }

  // "Done" advances a reminder's cadence server-side. It has to stop the click
  // from also navigating, which is why the row's button carries stopPropagation.
  const markReminderDone = async (item, e) => {
    e.stopPropagation()
    setItems(list => list.filter(i => i.key !== item.key))
    try { await api.post(`/bank-statements/reminders/${item.reminderId}/done`) } catch { load() }
  }

  const goTo = (item) => {
    setOpen(false)
    // Clicking a mention marks it read so it won't re-appear.
    if (item.type === 'mention' && item.mentionId) {
      api.post('/notifications/mentions/read', { id: item.mentionId }).catch(() => {})
      setItems(list => list.filter(i => i.key !== item.key))
    }
    navigate(item.link)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggleOpen}
        title="Notifications"
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        className="relative inline-flex items-center text-xs font-semibold p-1.5 rounded-lg border border-rule text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all"
      >
        <Bell size={15} />
        {count > 0 && (
          // Red, not the brand accent: this is an ALERT count. Painting it in
          // the workspace's own colour made it read as decoration. red-500 rather
          // than the `danger` token because the token flips to a PALE red in dark
          // (it is tuned as a foreground colour) and white would vanish on it.
          <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-1.5rem)] bg-card rounded-xl border border-rule shadow-modal z-50 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-divider">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowPrefs(v => !v)} title="Notification preferences"
                aria-label="Notification preferences"
                className={`p-1 rounded ${showPrefs ? 'text-brand-ink bg-brand-500/10' : 'text-ink-faint hover:text-ink'}`}>
                <Settings2 size={14} />
              </button>
              <button onClick={clearAll} className="text-[11px] font-medium text-ink-faint hover:text-brand-ink inline-flex items-center gap-1">
                <CheckCheck size={12} /> Clear
              </button>
            </div>
          </div>

          {showPrefs && (
            <div className="px-4 py-2.5 border-b border-divider bg-elev">
              <p className="text-[10px] font-bold text-ink-faint uppercase tracking-wider mb-1.5">Show notifications for</p>
              {Object.keys(PREF_DEFAULTS).map(k => (
                <label key={k} className="flex items-center gap-2 py-0.5 text-xs text-ink cursor-pointer">
                  <input type="checkbox" checked={prefs[k] !== false} onChange={e => setPref(k, e.target.checked)} />
                  {PREF_LABELS[k]}
                </label>
              ))}
            </div>
          )}

          <div className="max-h-[60vh] overflow-y-auto">
            {count === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={24} className="text-ink-faint mx-auto mb-2" />
                <p className="text-sm text-ink-muted">All clear — no pending alerts.</p>
              </div>
            ) : SECTIONS.map(sec => {
              const rows = bySection[sec.key] || []
              if (!rows.length) return null
              const SecIcon = sec.icon
              return (
                <div key={sec.key}>
                  <p className="flex items-center gap-1.5 px-4 pt-2.5 pb-1 text-[10px] font-bold text-ink-faint uppercase tracking-wider">
                    <SecIcon size={11} /> {sec.label} <span className="opacity-70">({rows.length})</span>
                  </p>
                  {rows.map(item => {
                    const Icon = ICONS[item.type] || Bell
                    return (
                      <div key={item.key} className="flex items-start gap-2 border-b border-divider last:border-0">
                        <button
                          onClick={() => goTo(item)}
                          className="flex-1 min-w-0 flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
                        >
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${SEVERITY[item.severity] || SEVERITY.info}`}>
                            <Icon size={14} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm text-ink">{item.title}</span>
                            <span className="block text-[11px] text-ink-faint">
                              {item.detail}{item.date ? ` · ${fmtDate(item.date)}` : ''}
                            </span>
                          </span>
                          {/* Days-until / completion chips: the two numbers that
                              decide whether a row needs action today. */}
                          {item.days_out != null && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                              item.days_out <= 3 ? 'bg-red-100 text-red-700'
                                : item.days_out <= 7 ? 'bg-orange-100 text-orange-700'
                                : 'bg-amber-100 text-amber-700'}`}>{item.days_out}d</span>
                          )}
                          {item.days_left != null && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                              item.days_left <= 30 ? 'bg-red-100 text-red-700'
                                : item.days_left <= 60 ? 'bg-orange-100 text-orange-700'
                                : 'bg-amber-100 text-amber-700'}`}>{item.days_left}d</span>
                          )}
                          {item.pct != null && item.group === 'budget' && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">{item.pct}%</span>
                          )}
                        </button>
                        {item.type === 'reminder' && (
                          <button onClick={(e) => markReminderDone(item, e)} title="Mark done"
                            className="mt-3 mr-3 p-1 rounded text-ink-faint hover:text-success hover:bg-gray-50 flex-shrink-0">
                            <Check size={14} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <button onClick={() => { setOpen(false); navigate('/notifications') }} className="w-full text-center text-xs font-semibold text-brand-ink hover:bg-gray-50 py-2.5 border-t border-divider">View all notifications</button>
        </div>
      )}
    </div>
  )
}

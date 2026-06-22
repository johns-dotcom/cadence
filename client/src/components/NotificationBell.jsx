import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Music, FileText, CheckSquare, Receipt } from 'lucide-react'
import api from '../api'

// Smart-alert bell. Polls /api/notifications (computed live, label-scoped) and
// shows a badge + dropdown. Each alert deep-links to the relevant page.
const ICONS = { release: Music, task: CheckSquare, contract: FileText, approval: Receipt }
const SEVERITY = {
  danger:  'text-red-600 bg-red-50',
  warning: 'text-amber-600 bg-amber-50',
  info:    'text-brand-600 bg-brand-50',
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [count, setCount] = useState(0)
  const ref = useRef(null)
  const navigate = useNavigate()

  const load = () => {
    api.get('/notifications')
      .then(r => { setItems(r.data.data.items || []); setCount(r.data.data.count || 0) })
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 120000) // refresh every 2 min
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''

  const open_ = () => { setOpen(v => !v); if (!open) load() }
  const goTo = (link) => { setOpen(false); navigate(link) }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={open_}
        title="Notifications"
        className="relative inline-flex items-center text-xs font-semibold p-1.5 rounded-lg border border-rule text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all"
      >
        <Bell size={15} />
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-brand-600 text-white text-[9px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card rounded-xl border border-rule shadow-modal z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            <span className="text-[11px] text-gray-400">{count} active</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={20} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">You're all caught up.</p>
              </div>
            ) : (
              items.map(item => {
                const Icon = ICONS[item.type] || Bell
                return (
                  <button
                    key={item.key}
                    onClick={() => goTo(item.link)}
                    className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left border-b border-divider last:border-0"
                  >
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${SEVERITY[item.severity] || SEVERITY.info}`}>
                      <Icon size={14} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-ink truncate">{item.title}</span>
                      <span className="block text-[11px] text-gray-400">
                        {item.detail}{item.date ? ` · ${fmtDate(item.date)}` : ''}
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

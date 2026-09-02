import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import { CheckCircle2, AlertTriangle, Info, X, Undo2 } from 'lucide-react'

const ToastContext = createContext()

let nextId = 1

const ICONS = {
  success: { Icon: CheckCircle2, cls: 'text-success' },
  error:   { Icon: AlertTriangle, cls: 'text-danger' },
  info:    { Icon: Info, cls: 'text-info' },
}
// Errors stay up longer than confirmations: a success is a receipt you glance
// at, an error is something you have to read and act on.
const DEFAULT_DURATION = { success: 3000, error: 5000, info: 4000 }

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]); delete timers.current[id]
    setToasts(ts => ts.filter(t => t.id !== id))
  }, [])

  /**
   * toast(message, type = 'success', opts?)
   *
   *   opts.action   { label, onClick } — renders a button in the toast. This is
   *                 what makes toast-undo possible: an action with a lifetime,
   *                 rather than a persistent bar the page has to find room for.
   *                 Clicking it dismisses the toast.
   *   opts.duration ms. `<= 0` means STICKY — no timer, dismiss by clicking X.
   *                 Use it for anything the person must acknowledge.
   *
   * The third argument is optional and the first two are unchanged, so all ~460
   * existing call sites keep working untouched.
   */
  const toast = useCallback((message, type = 'success', opts = {}) => {
    const id = nextId++
    const duration = opts.duration !== undefined ? opts.duration : (DEFAULT_DURATION[type] ?? 4000)
    setToasts(ts => [...ts, { id, message, type, action: opts.action || null }])
    if (duration > 0) timers.current[id] = setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {/* pointer-events-none on the COLUMN, auto on each card: without it the
          invisible flex gap between stacked toasts swallows clicks on whatever
          is underneath. Lifted above the mobile BottomNav (z-30, h-14) so a
          toast never covers navigation on a phone. */}
      <div className="fixed right-4 sm:right-6 bottom-20 lg:bottom-6 z-[100] flex flex-col gap-2 pointer-events-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {toasts.map(t => {
          const { Icon, cls } = ICONS[t.type] || ICONS.success
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex items-center gap-2.5 bg-card border border-rule shadow-modal rounded-xl px-4 py-3 min-w-[260px] max-w-[min(400px,calc(100vw-2rem))] animate-toast-in"
            >
              <Icon size={16} className={`${cls} flex-shrink-0`} />
              <span className="text-sm text-ink flex-1 min-w-0">{t.message}</span>
              {t.action && (
                <button
                  onClick={() => { t.action.onClick?.(); dismiss(t.id) }}
                  className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold text-brand-ink hover:underline"
                >
                  <Undo2 size={13} /> {t.action.label}
                </button>
              )}
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-ink-faint hover:text-ink flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

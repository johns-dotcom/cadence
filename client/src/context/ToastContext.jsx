import React, { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, AlertTriangle, X } from 'lucide-react'

const ToastContext = createContext()

let nextId = 1

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts(ts => ts.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message, type = 'success') => {
    const id = nextId++
    setToasts(ts => [...ts, { id, message, type }])
    setTimeout(() => dismiss(id), 4000)
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
        {toasts.map(t => (
          <div
            key={t.id}
            className="flex items-center gap-2.5 bg-card border border-rule shadow-modal rounded-xl px-4 py-3 min-w-[260px]"
          >
            {t.type === 'error'
              ? <AlertTriangle size={16} className="text-danger flex-shrink-0" />
              : <CheckCircle2 size={16} className="text-success flex-shrink-0" />}
            <span className="text-sm text-ink flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

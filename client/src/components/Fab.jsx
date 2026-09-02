import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, CheckSquare, Disc3, Receipt } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Mobile-only floating action button (<1024px). Expands to permission-filtered
// quick actions. Sits above the BottomNav via safe-area-aware offset.
export default function Fab() {
  const navigate = useNavigate()
  const { canView } = useAuth()
  const [open, setOpen] = useState(false)

  const actions = [
    // `?new=task` — TaskSurface consumes the param and opens the quick-add. Without
    // it this button was a plain navigation labelled "New task" that created nothing.
    canView('/my-work') && { label: 'New task', icon: CheckSquare, to: '/my-work?new=task' },
    canView('/releases') && { label: 'Add release', icon: Disc3, to: '/releases' },
    canView('/ledger') && { label: 'Add invoice', icon: Receipt, to: '/ledger/new-invoice' },
  ].filter(Boolean)

  if (!actions.length) return null

  const go = (to) => { setOpen(false); navigate(to) }

  return (
    <div className="lg:hidden fixed right-4 z-30" style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom) + 1rem)' }}>
      {open && (
        <>
          {/* Dimmed, not transparent: an open FAB is a modal choice, and the
              page behind it should stop competing for attention. */}
          <div className="fixed inset-0 -z-10 bg-black/20" onClick={() => setOpen(false)} />
          <div className="flex flex-col items-end gap-2 mb-3">
            {actions.map(a => {
              const Icon = a.icon
              return (
                <button key={a.label} onClick={() => go(a.to)} className="inline-flex items-center gap-2 bg-card border border-rule shadow-modal rounded-full pl-3 pr-4 py-2 text-sm font-medium text-ink">
                  <Icon size={16} className="text-brand-600" /> {a.label}
                </button>
              )
            })}
          </div>
        </>
      )}
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={open ? 'Close quick actions' : 'Quick actions'}
        className="ml-auto flex items-center justify-center w-14 h-14 rounded-full bg-brand-600 text-white shadow-modal active:scale-95 transition"
      >
        {open ? <X size={22} /> : <Plus size={24} />}
      </button>
    </div>
  )
}

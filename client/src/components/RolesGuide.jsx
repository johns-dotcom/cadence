import { useState } from 'react'
import { ChevronDown, ChevronRight, Check, X } from 'lucide-react'
import { ROLE_GUIDE, AXES, PRESET_NOTE } from '../lib/roles'

// What the four roles do, and the four things people call "permissions".
//
// Sits directly above the permissions editor because it answers the questions
// that editor provokes: why ticking pages for an Admin does nothing, why moving
// somebody to Finance did not give them the ledger, and why there is no
// "Bookkeeper" role to pick.
//
// Collapsed by default — it is reference material, and the tools below it are
// what someone opened this tab to use.
export default function RolesGuide() {
  const [open, setOpen] = useState(false)

  return (
    <div className="card mt-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left hover:bg-elev/50 transition-colors rounded-xl"
        aria-expanded={open}
      >
        <span>
          <span className="block text-sm font-semibold text-ink">How access actually works</span>
          <span className="block text-xs text-ink-muted mt-0.5">
            The four roles, and the four different things people mean by &ldquo;permissions&rdquo;.
          </span>
        </span>
        {open ? <ChevronDown size={16} className="text-ink-faint flex-shrink-0" />
              : <ChevronRight size={16} className="text-ink-faint flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-divider px-5 py-4 space-y-6">
          {/* The axes come FIRST. Reading the role table without them is how
              somebody concludes that hierarchy level 1 outranks an Admin. */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Four things called &ldquo;permissions&rdquo;
            </h3>
            <dl className="mt-2 space-y-2.5">
              {AXES.map(axis => (
                <div key={axis.name} className="text-sm">
                  <dt className="font-medium text-ink">
                    {axis.name}
                    <span className="ml-2 font-normal text-ink-muted">{axis.decides}</span>
                  </dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-ink-muted">{axis.detail}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">The four roles</h3>
            <div className="mt-2 space-y-4">
              {ROLE_GUIDE.map(r => (
                <div key={r.role} className="rounded-lg border border-rule p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-ink">{r.role}</span>
                    <span className="text-xs text-ink-muted">{r.summary}</span>
                  </div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <ul className="space-y-1">
                      {r.can.map(item => (
                        <li key={item} className="flex items-start gap-1.5 text-xs text-ink-muted">
                          <Check size={12} className="mt-0.5 flex-shrink-0 text-success" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                    <ul className="space-y-1">
                      {r.cannot.map(item => (
                        <li key={item} className="flex items-start gap-1.5 text-xs text-ink-muted">
                          <X size={12} className="mt-0.5 flex-shrink-0 text-danger" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p className="mt-2 border-t border-divider pt-2 text-xs text-ink-faint">
                    <span className="font-medium text-ink-muted">Pages: </span>{r.pages}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <p className="rounded-lg bg-elev px-3 py-2 text-xs leading-relaxed text-ink-muted">
            {PRESET_NOTE}
          </p>
        </div>
      )}
    </div>
  )
}

// The books-closed watermark. Renders NOTHING when no month is reconciled or
// the viewer lacks statements access — silence, not an error.

import { Link } from 'react-router-dom'
import { Landmark } from 'lucide-react'
import useReconciledThrough from '../../hooks/useReconciledThrough'

const label = (ym) => {
  const [y, m] = String(ym).split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(m) - 1]} ${y}`
}

export default function ReconciledBadge() {
  const state = useReconciledThrough()
  if (!state?.through) return null
  return (
    <Link
      to="/bank-matching"
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full ${
        state.reopened ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
      }`}
      title={state.reopened ? 'A reconciled month has open debits again — something changed after the close' : 'Every bank month up to this one is reconciled'}
    >
      <Landmark size={11} /> Reconciled through {label(state.through)}{state.reopened ? ' · reopened' : ''}
    </Link>
  )
}

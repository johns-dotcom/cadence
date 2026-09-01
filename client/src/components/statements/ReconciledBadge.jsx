// The books-closed watermark. Renders NOTHING when no month is reconciled or
// the viewer lacks statements access — silence, not an error.

import { Link } from 'react-router-dom'
import useReconciledThrough from '../../hooks/useReconciledThrough'

const label = (ym) => {
  const [y, m] = String(ym).split('-')
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${names[Number(m) - 1]} ${y}`
}

export default function ReconciledBadge() {
  const state = useReconciledThrough()
  if (!state?.through) return null
  return (
    <Link
      to="/bank-matching"
      className={`inline-flex items-center text-[11px] font-bold rounded-full px-2 py-0.5 border ${
        state.reopened
          ? 'text-amber-700 bg-amber-50 border-amber-200'
          : 'text-emerald-700 bg-emerald-50 border-emerald-200'
      }`}
      title={state.reopened ? 'A reconciled month has open debits again — something changed after the close' : 'Every bank month up to this one is reconciled'}
    >
      Reconciled through {label(state.through)}{state.reopened ? ' · reopened' : ''}
    </Link>
  )
}

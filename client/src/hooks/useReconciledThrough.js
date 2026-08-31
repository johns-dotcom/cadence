// "Reconciled through <month>" — the latest month such that every
// statement-bearing month up to it is marked reconciled. Swallows 403s so a
// non-admin viewer renders nothing rather than an error (bank data is
// admin-only; the badge must never leak that it even exists).

import { useEffect, useState } from 'react'
import api from '../api'

let cache
let inflight = null

export default function useReconciledThrough() {
  const [state, setState] = useState(cache ?? null)
  useEffect(() => {
    if (cache !== undefined) { setState(cache); return }
    if (!inflight) {
      inflight = api.get('/bank-statements/months')
        .then((r) => {
          const months = (r.data.data || []).slice().sort((a, b) => (a.month_key < b.month_key ? -1 : 1))
          let through = null
          let reopened = false
          for (const m of months) {
            if (m.reconciled_at) {
              through = m.month_key
              if (m.open_debits > 0) reopened = true
            } else break
          }
          cache = through ? { through, reopened } : null
          return cache
        })
        .catch(() => { cache = null; return null })
        .finally(() => { inflight = null })
    }
    inflight.then((v) => setState(v))
  }, [])
  return state
}

export function resetReconciledCache() { cache = undefined }

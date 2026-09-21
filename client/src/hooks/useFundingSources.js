// The workspace's funding sources — the people/entities who front money when
// there's no label bank account. The label's own account is the implicit
// default (a null paid_source_id), so it is NOT a row here; the picker prepends
// it. One module-level fetch shared by every picker, refetched on window focus
// so a payer added mid-flow shows up everywhere.
import { useEffect, useState } from 'react'
import api from '../api'

let cache = null
let inflight = null
const listeners = new Set()

function emit() { listeners.forEach(fn => fn(cache)) }

async function fetchSources() {
  if (inflight) return inflight
  inflight = api.get('/ledger/funding-sources')
    .then(r => { cache = r.data.data || []; emit(); return cache })
    .catch(() => { if (!cache) cache = []; return cache })
    .finally(() => { inflight = null })
  return inflight
}

// Call after enterWorkspace / logout so one tenant's payers never leak into the
// next (mirrors resetCategoriesCache).
export function resetFundingSourcesCache() { cache = null; inflight = null; emit() }

export default function useFundingSources() {
  const [sources, setSources] = useState(cache || [])
  const [loading, setLoading] = useState(cache === null)

  useEffect(() => {
    const fn = (c) => setSources(c || [])
    listeners.add(fn)
    if (cache === null) fetchSources().finally(() => setLoading(false))
    else setSources(cache)
    const onFocus = () => fetchSources()
    window.addEventListener('focus', onFocus)
    return () => { listeners.delete(fn); window.removeEventListener('focus', onFocus) }
  }, [])

  // Add a payer and return it, updating every subscriber.
  const addSource = async (name, kind = 'person') => {
    const { data } = await api.post('/ledger/funding-sources', { name, kind })
    const src = data.data
    cache = [...(cache || []).filter(s => s.id !== src.id), src]
    emit()
    return src
  }

  const refetch = () => fetchSources()
  return { sources, loading, addSource, refetch }
}

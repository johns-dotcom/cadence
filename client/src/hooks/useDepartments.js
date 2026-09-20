import { useCallback, useEffect, useState } from 'react'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { DEPARTMENTS } from '../constants'

// The workspace's department names, with the shipped constant as the floor.
//
// Departments became per-workspace (a label can rename A&R or add Publishing),
// but four surfaces render a picker from this list and one of them — the
// add-a-member form on Team — is useless with an empty dropdown. So this never
// returns nothing: while the request is in flight, and if it fails, callers get
// `DEPARTMENTS`. A workspace that has never customised its list sees the same
// six either way, because the bootstrap seeds exactly those.
//
// Cached at module scope per label, so five mounted pickers make one request
// and a remount is instant. Keyed by labelId and cleared on switch — a stale
// list from the previous tenant would offer departments this one never had.
let cache = { labelId: null, names: null, rows: null }

export function clearDepartmentCache() {
  cache = { labelId: null, names: null, rows: null }
}

export default function useDepartments() {
  // The hook reads the workspace itself rather than making four call sites
  // thread a label id through — every caller is inside the authed tree, and a
  // caller passing the wrong id would cache one tenant's list under another's.
  const { label } = useAuth()
  const labelId = label?.id ?? null
  const cached = cache.labelId === labelId && cache.names
  const [names, setNames] = useState(cached ? cache.names : DEPARTMENTS)
  const [rows, setRows] = useState(cached ? cache.rows : [])
  const [loading, setLoading] = useState(!cached)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    if (cache.labelId === labelId && cache.names && nonce === 0) {
      setNames(cache.names); setRows(cache.rows); setLoading(false)
      return () => { alive = false }
    }
    setLoading(true)
    api.get('/departments')
      .then(res => {
        if (!alive) return
        const list = Array.isArray(res.data?.data) ? res.data.data : []
        // An empty list is a real answer — a workspace that deleted every
        // department. Falling back to the constant here would silently
        // resurrect six names an admin had deliberately removed.
        const next = list.map(d => d.name)
        cache = { labelId, names: next, rows: list }
        setNames(next); setRows(list)
      })
      .catch(() => {
        // Offline, 500, or a token that just expired: hold the floor rather
        // than emptying every picker on the page.
        if (alive) { setNames(DEPARTMENTS); setRows([]) }
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [labelId, nonce])

  const refresh = useCallback(() => {
    clearDepartmentCache()
    setNonce(n => n + 1)
  }, [])

  return { departments: names, rows, loading, refresh }
}

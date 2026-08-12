// View state + the one filter → sort → group pipeline, plus saved-view CRUD.
//
// Every view (Board / Table / Calendar / List / Workload) consumes the output of
// this hook, so the counts in a group header, the rows in the table and the bars in
// the Workload rollup cannot disagree — they're all derived from `sorted`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { ALL_COL_KEYS, groupTasks, matches, sortTasks } from './taskFields'
import { defaultView, hydrateView, presetsFor, EMPTY_FILTERS } from '../../constants/taskViews'

export default function useTaskView(surface, tasks, members) {
  const { user, label } = useAuth()
  const { toast } = useToast()

  const [view, setView] = useState(() => defaultView(surface))
  const [savedViews, setSavedViews] = useState([])
  const [activeViewId, setActiveViewId] = useState(null)

  // Which view you had open is genuinely device-dependent (Board at a desk, List
  // on a phone), so the LAST-USED id lives in localStorage while the views
  // themselves live server-side. Filters are never serialised into the URL.
  const storeKey = `mywork-view:${surface}:${label?.id || 0}:${user?.id || 0}`

  const presets = useMemo(() => presetsFor(surface), [surface])

  // Presets are constants; only user-created views come from the API. An empty
  // response is a normal state, not an onboarding problem.
  const allViews = useMemo(() => [...presets, ...savedViews], [presets, savedViews])

  useEffect(() => {
    setView(defaultView(surface))
    setActiveViewId(null)
  }, [surface])

  useEffect(() => {
    let cancelled = false
    api.get('/tasks/views')
      .then(res => {
        if (cancelled) return
        const rows = (res.data.data || []).filter(v => (v.config?.surface || 'mine') === surface)
        setSavedViews(rows.map(v => ({ id: String(v.id), name: v.name, config: v.config || {} })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [surface])

  // Restore the last-used view once its definition is available.
  //
  // Guarded by a ref, not by `activeViewId`: any manual tweak clears activeViewId,
  // so an activeViewId check would let the late-arriving saved-views fetch restore
  // over changes the user made in the meantime and silently discard them.
  const restoredRef = useRef(false)
  useEffect(() => { restoredRef.current = false }, [surface])
  useEffect(() => {
    if (restoredRef.current) return
    const last = localStorage.getItem(storeKey)
    if (!last) { restoredRef.current = true; return }
    const found = allViews.find(v => v.id === last)
    if (!found) return // may be a saved view that hasn't loaded yet
    restoredRef.current = true
    setView(hydrateView(found.config, surface))
    setActiveViewId(found.id)
  }, [allViews, storeKey, surface])

  // Any manual tweak detaches from the saved view, so "dirty" is just "no active
  // id" — no deep comparison needed.
  const mutate = useCallback((patch) => {
    setView(v => ({ ...v, ...(typeof patch === 'function' ? patch(v) : patch) }))
    setActiveViewId(null)
  }, [])

  const setType = useCallback((type) => mutate({ type }), [mutate])
  const setGroup = useCallback((group) => mutate({ group }), [mutate])
  const setSort = useCallback((key, dir) => mutate(v => ({ sort: { key, dir: dir || (v.sort.key === key && v.sort.dir === 'asc' ? 'desc' : 'asc') } })), [mutate])
  const setFilter = useCallback((key, value) => mutate(v => ({ filters: { ...v.filters, [key]: value } })), [mutate])
  const resetFilters = useCallback(() => mutate({ filters: { ...EMPTY_FILTERS } }), [mutate])

  // Toggle one value inside a multi-select filter array.
  const toggleFilterValue = useCallback((key, value) => {
    mutate(v => {
      const cur = v.filters[key] || []
      return { filters: { ...v.filters, [key]: cur.includes(value) ? cur.filter(x => x !== value) : [...cur, value] } }
    })
  }, [mutate])

  const toggleColumn = useCallback((key) => {
    mutate(v => {
      const has = v.columns.includes(key)
      // Keep at least one column, and keep them in canonical COLS order so the
      // table doesn't reshuffle as you toggle.
      if (has && v.columns.length === 1) return {}
      const next = has ? v.columns.filter(k => k !== key) : [...v.columns, key]
      return { columns: ALL_COL_KEYS.filter(k => next.includes(k)) }
    })
  }, [mutate])

  const applyView = useCallback((id) => {
    const found = allViews.find(v => v.id === id)
    if (!found) return
    setView(hydrateView(found.config, surface))
    setActiveViewId(id)
    localStorage.setItem(storeKey, id)
  }, [allViews, storeKey, surface])

  // Upserts by case-insensitive name server-side, so re-saving "Today" replaces it.
  const saveView = useCallback(async (name) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return null
    try {
      const { data } = await api.post('/tasks/views', { name: trimmed, config: { ...view, surface } })
      const row = { id: String(data.data.id), name: data.data.name, config: data.data.config || {} }
      setSavedViews(vs => [...vs.filter(v => v.id !== row.id), row].sort((a, b) => a.name.localeCompare(b.name)))
      setActiveViewId(row.id)
      localStorage.setItem(storeKey, row.id)
      toast(`View “${row.name}” saved`)
      return row
    } catch (err) {
      toast(err.response?.data?.error || 'Could not save view', 'error')
      return null
    }
  }, [view, surface, storeKey, toast])

  const deleteView = useCallback(async (id) => {
    try {
      await api.delete(`/tasks/views/${id}`)
      setSavedViews(vs => vs.filter(v => v.id !== id))
      if (activeViewId === id) { setActiveViewId(null); localStorage.removeItem(storeKey) }
      toast('View deleted')
    } catch (err) {
      toast(err.response?.data?.error || 'Could not delete view', 'error')
    }
  }, [activeViewId, storeKey, toast])

  // ── The pipeline ─────────────────────────────────────────────────────────
  // Not debounced: at ~1k rows this is microseconds per keystroke. If a workspace
  // ever crosses ~5k tasks, debounce view.filters.q here — one isolated change.
  const filtered = useMemo(() => tasks.filter(t => matches(t, view.filters)), [tasks, view.filters])
  const sorted = useMemo(() => sortTasks(filtered, view.sort), [filtered, view.sort])
  const groups = useMemo(() => groupTasks(sorted, view.group, { members }), [sorted, view.group, members])

  const activeFilterCount = useMemo(() => {
    const f = view.filters
    let n = 0
    if (f.q) n++
    for (const k of ['status', 'priority', 'user_id', 'category', 'department']) if (f[k]?.length) n++
    if (f.due && f.due !== 'any') n++
    if (f.release_id) n++
    if (!f.hide_old_done) n++
    return n
  }, [view.filters])

  return {
    view, setView, setType, setGroup, setSort, setFilter, toggleFilterValue, resetFilters, toggleColumn,
    savedViews, presets, allViews, activeViewId, isDirty: !activeViewId, applyView, saveView, deleteView,
    filtered, sorted, groups, activeFilterCount,
  }
}

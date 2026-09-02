// Task fetching + mutation for My Work / Team Work.
//
// Two deliberate differences from the Ledger's edit model (Ledger.jsx:122-142):
//  · the failure path restores the CAPTURED row instead of calling load(), so a
//    failed edit doesn't cost a full refetch, a flicker and a scroll jump;
//  · the success path merges the SERVER row, so derived fields (completed_at, and
//    sort_order after a renormalize) land without a refetch.
//
// load() therefore runs on mount, on surface change, and after a renormalizing
// reorder — nowhere else. The old page refetched after every single mutation.

import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

const UNDO_DEPTH = 20
const GAP = 1024

const pick = (obj, keys) => keys.reduce((o, k) => ({ ...o, [k]: obj?.[k] ?? null }), {})

/**
 * The same integer-midpoint rule the server applies, run locally so the optimistic
 * position matches what comes back. Returns null when the gap is exhausted or the
 * neighbours have no order yet — the server will renormalize and we refetch once.
 */
export function midpointFor(tasks, beforeId, afterId) {
  const orderOf = (id) => {
    if (id == null) return null
    const t = tasks.find(x => x.id === id)
    return t && t.sort_order != null ? t.sort_order : null
  }
  const above = orderOf(beforeId)
  const below = orderOf(afterId)
  if (above != null && below != null) {
    const lo = Math.min(above, below)
    const hi = Math.max(above, below)
    const mid = Math.floor((lo + hi) / 2)
    return mid === lo || mid === hi ? null : mid
  }
  if (below != null) return below - GAP
  if (above != null) return above + GAP
  return null
}

export default function useTaskData(surface = 'mine') {
  const { toast } = useToast()
  // Impersonation and "enter workspace" swap the acting user WITHOUT unmounting the
  // route, so a load keyed only on `surface` left the previous person's tasks on
  // screen — editable, and 403ing on save.
  const { user } = useAuth()
  const actingUserId = user?.id
  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [releases, setReleases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [undoStack, setUndoStack] = useState([])
  // The assignment notification the server PREPARED but did not send. Assignment
  // email used to leave silently, fire-and-forget: no preview, no CC, no way to
  // skip it, and no way to know whether it went. Holding it here lets TaskSurface
  // raise EmailPreviewModal — the same review-before-send path every other
  // outbound email in the app already takes.
  const [pendingEmail, setPendingEmail] = useState(null)
  const clearPendingEmail = useCallback(() => setPendingEmail(null), [])
  // Kept in a ref so mutators don't need `tasks` in their dep list (which would
  // rebuild every callback on each keystroke of an inline edit).
  const tasksRef = useRef([])
  tasksRef.current = tasks

  const load = useCallback(() => {
    setLoading(true)
    const url = surface === 'team' ? '/tasks?scope=team' : '/tasks'
    return api.get(url)
      .then(res => { setTasks(res.data.data || []); setError(null) })
      .catch(err => setError(err.response?.data?.error || 'Failed to load tasks'))
      .finally(() => setLoading(false))
  }, [surface, actingUserId])

  useEffect(() => { load() }, [load])

  // Unconditionally, for every role: assignee chips, the drawer and the Workload
  // roster all need names. GET /api/team is auth-only (not admin-gated) and
  // returns only name/email/role/department, already visible app-wide.
  useEffect(() => {
    api.get('/team').then(res => setMembers(res.data.data || [])).catch(() => {})
    // Options for the drawer's release picker. `in_catalog=any&archived=any` opts
    // OUT of GET /releases' pipeline default — a task can legitimately hang off a
    // catalogued or archived release, and the default scope would silently drop
    // those from the list while the task still displayed one.
    api.get('/releases', { params: { in_catalog: 'any', archived: 'any', limit: 500 } })
      .then(res => setReleases(res.data.data || [])).catch(() => {})
  }, [actingUserId])

  const applyLocal = useCallback((id, fields) => {
    setTasks(ts => ts.map(t => (t.id === id ? { ...t, ...fields } : t)))
  }, [])

  const patchTask = useCallback(async (id, fields, { silent = false, undoable = true } = {}) => {
    const prev = tasksRef.current.find(t => t.id === id)
    if (!prev) return false
    applyLocal(id, fields)
    if (undoable) {
      setUndoStack(s => [...s.slice(-(UNDO_DEPTH - 1)), { id, fields: pick(prev, Object.keys(fields)) }])
    }
    try {
      // notify:'preview' makes the server PREPARE the assignment email and hand it
      // back instead of sending it. Only on a reassignment — every other field
      // patch has nothing to notify about.
      const body = 'user_id' in fields ? { ...fields, notify: 'preview' } : fields
      const { data } = await api.patch(`/tasks/${id}`, body)
      if (data?.data) applyLocal(id, data.data)
      if (data?.pending_email) setPendingEmail(data.pending_email)
      if (!silent) toast('Saved')
      return true
    } catch (err) {
      setTasks(ts => ts.map(t => (t.id === id ? prev : t))) // exact rollback
      if (undoable) setUndoStack(s => s.slice(0, -1))
      toast(err.response?.data?.error || 'Save failed', 'error')
      return false
    }
  }, [applyLocal, toast])

  const undoLast = useCallback(() => {
    const last = undoStack[undoStack.length - 1]
    if (!last) return
    setUndoStack(s => s.slice(0, -1))
    patchTask(last.id, last.fields, { silent: true, undoable: false })
  }, [undoStack, patchTask])

  const createTask = useCallback(async (form) => {
    try {
      const body = form.user_id ? { ...form, notify: 'preview' } : form
      const { data } = await api.post('/tasks', body)
      // POST returns RETURNING *, so prepend rather than refetching. It also comes
      // back at the top of the manual order, matching where it lands here.
      if (data?.data) setTasks(ts => [data.data, ...ts])
      if (data?.pending_email) setPendingEmail(data.pending_email)
      toast('Task added')
      return data?.data || null
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add task', 'error')
      return null
    }
  }, [toast])

  const removeTask = useCallback(async (id) => {
    const prev = tasksRef.current
    setTasks(ts => ts.filter(t => t.id !== id))
    try {
      await api.delete(`/tasks/${id}`)
      toast('Task deleted')
      return true
    } catch (err) {
      setTasks(prev)
      toast(err.response?.data?.error || 'Failed to delete', 'error')
      return false
    }
  }, [toast])

  /**
   * Multi-select edit. The server skips out-of-scope ids rather than failing the
   * batch, so report the shortfall instead of implying everything landed.
   *
   * Returns the updated rows, or NULL if the request failed — the caller needs to
   * tell those apart, because clearing the selection after a failure throws away
   * the user's work along with the error.
   */
  const bulkPatch = useCallback(async (ids, fields) => {
    try {
      const { data } = await api.patch('/tasks/bulk', { ids, fields })
      const rows = data?.data || []
      const byId = new Map(rows.map(r => [r.id, r]))
      setTasks(ts => ts.map(t => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t)))
      if (rows.length < ids.length) toast(`${rows.length} of ${ids.length} updated`, 'error')
      else toast(`${rows.length} task${rows.length === 1 ? '' : 's'} updated`)
      return rows
    } catch (err) {
      toast(err.response?.data?.error || 'Bulk update failed', 'error')
      return null
    }
  }, [toast])

  /**
   * Move a task between two neighbours. `fields` is the group's implied patch when
   * the drop crossed groups (null for a pure reorder) — sent as one PATCH so the
   * field change and the position change don't race each other.
   */
  const reorderTask = useCallback(async (id, beforeId, afterId, fields = null) => {
    const prev = tasksRef.current.find(t => t.id === id)
    if (!prev) return false
    const optimistic = midpointFor(tasksRef.current, beforeId, afterId)
    applyLocal(id, { ...(fields || {}), ...(optimistic != null ? { sort_order: optimistic } : {}) })

    try {
      if (fields) await api.patch(`/tasks/${id}`, fields)
      const { data } = await api.patch(`/tasks/${id}/reorder`, { before_id: beforeId ?? null, after_id: afterId ?? null })
      if (data?.data) applyLocal(id, data.data)
      // Renormalizing rewrote every row's sort_order, so our local copies of the
      // OTHER rows are stale. This is the only mutation that costs a refetch.
      if (data?.renormalized) await load()
      return true
    } catch (err) {
      // A cross-group drag is two requests (field change, then position). If the
      // second fails the first may already have committed, so a local rollback
      // alone would leave the page disagreeing with the server — resync instead of
      // guessing which half landed.
      setTasks(ts => ts.map(t => (t.id === id ? prev : t)))
      toast(err.response?.data?.error || 'Could not move task', 'error')
      if (fields) load()
      return false
    }
  }, [applyLocal, load, toast])

  return {
    tasks, members, releases, loading, error, load,
    createTask, patchTask, bulkPatch, reorderTask, removeTask,
    undoLast, undoDepth: undoStack.length,
    pendingEmail, clearPendingEmail,
  }
}

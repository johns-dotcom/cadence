import { useEffect, useState } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { ConfirmDialog } from './ui'
import { clearDepartmentCache } from '../hooks/useDepartments'

// The workspace's department vocabulary.
//
// Departments are not a permission — they group people on Team, Salary,
// Activity and My Work, and they seed a page preset when an account is made.
// The Roles panel above says so explicitly, because this is the axis people
// most often mistake for access.
//
// A department is a NAME, not a foreign key: `users.department` stays a plain
// string. That is what makes renaming safe to offer here — the rename carries
// its people with it in one transaction server-side — and it is why deleting
// one has to ask where its members go rather than silently stranding them in a
// group no picker offers.
export default function DepartmentsManager() {
  const { label } = useAuth()
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [unlisted, setUnlisted] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState('')
  const [editing, setEditing] = useState(null)   // { id, name }
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)   // { row, reassign }

  const load = () => {
    setLoading(true)
    api.get('/departments')
      .then(res => { setRows(res.data.data || []); setUnlisted(res.data.unlisted || []) })
      .catch(() => toast('Failed to load departments', 'error'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  // Every picker in the app reads a module-scope cache; a change here has to
  // invalidate it or the Team dropdown keeps offering yesterday's list until
  // a full reload.
  const done = (msg) => { clearDepartmentCache(); load(); if (msg) toast(msg) }

  const add = async (e) => {
    e.preventDefault()
    const name = adding.trim()
    if (!name) return
    setBusy(true)
    try {
      await api.post('/departments', { name, sort_order: (rows.length + 1) * 10 })
      setAdding('')
      done(`Added ${name}`)
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add', 'error')
    } finally { setBusy(false) }
  }

  const rename = async () => {
    const name = editing.name.trim()
    if (!name) return
    setBusy(true)
    try {
      const { data } = await api.patch(`/departments/${editing.id}`, { name })
      setEditing(null)
      done(data.moved > 0
        ? `Renamed — ${data.moved} ${data.moved === 1 ? 'person' : 'people'} moved with it`
        : 'Renamed')
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to rename', 'error')
    } finally { setBusy(false) }
  }

  const remove = async () => {
    const { row, reassign } = confirm
    setBusy(true)
    try {
      const q = row.member_count > 0 ? `?reassign=${encodeURIComponent(reassign)}` : ''
      const { data } = await api.delete(`/departments/${row.id}${q}`)
      setConfirm(null)
      done(data.moved > 0
        ? `Deleted — ${data.moved} ${data.moved === 1 ? 'person' : 'people'} moved`
        : 'Deleted')
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="card p-5 mt-6">
      <h2 className="text-sm font-semibold text-ink">Departments</h2>
      <p className="mt-1 text-xs text-ink-muted">
        How this workspace groups its people. Departments seed a page preset when an account is made —
        they do not grant access on their own.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-ink-muted">Loading…</p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-divider">
            {rows.map(row => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
                {editing?.id === row.id ? (
                  <>
                    <input
                      autoFocus
                      className="input !w-48 !py-1 text-sm"
                      value={editing.name}
                      onChange={e => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); rename() }
                        if (e.key === 'Escape') setEditing(null)
                      }}
                    />
                    <button onClick={rename} disabled={busy} className="p-1 text-success hover:opacity-80" title="Save"><Check size={15} /></button>
                    <button onClick={() => setEditing(null)} className="p-1 text-ink-faint hover:text-ink" title="Cancel"><X size={15} /></button>
                    {row.member_count > 0 && (
                      <span className="text-xs text-ink-muted">
                        {row.member_count} {row.member_count === 1 ? 'person moves' : 'people move'} with it
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 truncate text-sm text-ink">{row.name}</span>
                    <span className="text-xs text-ink-faint tabular-nums">
                      {row.member_count} {row.member_count === 1 ? 'person' : 'people'}
                    </span>
                    {/* Level 1 sorts to the top of every member list. Shown
                        because it is otherwise invisible until someone wonders
                        why Executive is always first. */}
                    {row.default_hierarchy === 1 && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">sorts first</span>
                    )}
                    <button onClick={() => setEditing({ id: row.id, name: row.name })}
                      className="p-1 text-ink-faint hover:text-ink" title="Rename"><Pencil size={14} /></button>
                    <button onClick={() => setConfirm({ row, reassign: rows.find(r => r.id !== row.id)?.name || 'none' })}
                      className="p-1 text-ink-faint hover:text-danger" title="Delete"><Trash2 size={14} /></button>
                  </>
                )}
              </li>
            ))}
            {rows.length === 0 && (
              <li className="py-3 text-sm text-ink-muted">
                No departments. Every picker will fall back to the shipped list until you add one.
              </li>
            )}
          </ul>

          {/* Values people are actually in that the list has lost — typed into
              the Salary datalist, or left behind by a delete. Surfaced so the
              roster and the vocabulary can be reconciled rather than quietly
              disagreeing. */}
          {unlisted.length > 0 && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
              <span className="font-semibold text-warning">Not in the list, but in use: </span>
              {unlisted.map((u, i) => (
                <span key={u.name}>
                  {i > 0 && ', '}
                  {u.name} ({u.member_count})
                </span>
              ))}
              <span className="block mt-1 text-ink-muted">
                Add them above to make them pickable, or move those people to a department that exists.
              </span>
            </div>
          )}

          <form onSubmit={add} className="mt-4 flex items-center gap-2">
            <input
              className="input !w-48 !py-1 text-sm"
              placeholder="New department"
              value={adding}
              onChange={e => setAdding(e.target.value)}
            />
            <button type="submit" disabled={busy || !adding.trim()} className="btn-secondary !py-1 !px-2.5 text-xs">
              <Plus size={13} /> Add
            </button>
          </form>
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={remove}
        title={confirm ? `Delete ${confirm.row.name}?` : ''}
        message={
          confirm
            ? confirm.row.member_count === 0
              ? `Nobody is in ${confirm.row.name}, so nothing moves.`
              : `${confirm.row.member_count} ${confirm.row.member_count === 1 ? 'person is' : 'people are'} in `
                + `${confirm.row.name}. They will move to ${confirm.reassign === 'none' ? 'no department' : confirm.reassign}.`
            : ''
        }
      />
    </div>
  )
}

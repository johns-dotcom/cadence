// Per-user rep visibility — which reps' ledger entries a member is allowed to see.
//
// The endpoints (GET/PUT /api/settings/visible-reps/:userId) and the enforcement
// (routes/ledger.js) both shipped, but nothing in the client ever called them: the
// only way to restrict someone was a direct DB write. This is the missing editor.
//
// Empty set = SEE EVERY REP. That default is why an "unrestricted" state has to be
// stated on screen rather than implied by an empty list — an admin who ticks nothing
// and saves has granted full visibility, not revoked it, and the two are opposite.

import { useEffect, useState } from 'react'
import { Check, Eye } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'

// Page permissions bind Users only; rep visibility is different — an Approver is
// exactly the role you would scope to a rep, so the only unrestricted tier is admin.
const ALWAYS_ALL = ['Superadmin', 'Admin']

export default function VisibleRepsManager() {
  const { toast } = useToast()
  const [users, setUsers] = useState([])
  const [reps, setReps] = useState([])
  const [selId, setSelId] = useState('')
  const [visible, setVisible] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/team').then(r => setUsers(r.data.data || [])).catch(() => {})
    api.get('/reps').then(r => setReps(r.data.data || [])).catch(() => {})
  }, [])

  const selected = users.find(u => String(u.id) === String(selId))
  const isUnrestricted = selected && ALWAYS_ALL.includes(selected.role)

  const pickUser = async (id) => {
    setSelId(id)
    setVisible(new Set())
    if (!id) return
    setLoading(true)
    try { const { data } = await api.get(`/settings/visible-reps/${id}`); setVisible(new Set(data.data || [])) }
    catch { toast('Could not load their rep list', 'error') }
    finally { setLoading(false) }
  }

  const toggle = (name) => setVisible(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })

  const save = async () => {
    if (!selId) return
    setSaving(true)
    try {
      // A full selection means "everything", and storing it as a literal list would
      // silently exclude every rep added later. Store [] so the set stays open.
      const list = [...visible]
      const payload = list.length >= reps.length ? [] : list
      await api.put(`/settings/visible-reps/${selId}`, { reps: payload })
      if (payload.length === 0) setVisible(new Set())
      toast(payload.length ? `Limited to ${payload.length} rep${payload.length === 1 ? '' : 's'}` : 'Set to all reps')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><Eye size={15} /> Rep visibility</h2>
      <p className="text-xs text-ink-muted mb-4">
        Limit which reps' ledger entries a member can see. Tick nothing to leave them unrestricted —
        an empty list means <strong>all reps</strong>, including ones added later.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="label" htmlFor="visrep-member">Member</label>
          <select id="visrep-member" className="input !w-56" value={selId} onChange={e => pickUser(e.target.value)}>
            <option value="">— select member —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
          </select>
        </div>
        {selId && !isUnrestricted && (
          <button onClick={save} disabled={saving || loading} className="btn-primary">
            {saving ? 'Saving…' : 'Save rep visibility'}
          </button>
        )}
      </div>

      {!selId ? (
        <p className="text-sm text-ink-muted">Pick a member to see and edit their rep list.</p>
      ) : isUnrestricted ? (
        <p className="text-sm text-ink-muted">
          {selected.role}s always see every rep — the ledger filter does not apply to them.
        </p>
      ) : reps.length === 0 ? (
        <p className="text-sm text-ink-muted">No reps in this workspace yet — add some below first.</p>
      ) : loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <>
          <p className="text-[11px] text-ink-muted mb-2">
            {visible.size === 0
              ? `${selected.name} currently sees ALL reps.`
              : `${selected.name} sees ${visible.size} of ${reps.length} reps.`}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {reps.map(r => {
              const on = visible.has(r.name)
              return (
                <button
                  key={r.id}
                  onClick={() => toggle(r.name)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border text-left transition
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
                    ${on ? 'border-brand-400 bg-brand-500/10 text-ink' : 'border-rule text-ink-muted hover:bg-elev'}`}
                >
                  <Check size={12} className={on ? 'text-brand-ink' : 'opacity-0'} aria-hidden="true" />
                  <span className="truncate">{r.name}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

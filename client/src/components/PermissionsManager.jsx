import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Search, Sparkles, Trash2, Save, ShieldCheck } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import ConfirmDialog from './ui/ConfirmDialog'
import { PAGE_GROUPS, ALL_PAGES, PERMISSION_PRESETS } from '../constants/pages'

// Admin tool: edit a User's page allow-list, apply presets/templates, save the
// current set as a reusable template, and copy another user's set.
//
// THE ONE THING TO UNDERSTAND HERE: no permission rows at all means
// UNRESTRICTED (AuthContext's canView returns true when pagePermissions is
// null). So "save an empty list" is the SERVER's way of spelling "grant
// everything" — which is the exact inverse of what an admin means when they
// untick every box. The access level is therefore an explicit choice on screen,
// and the restricted branch never sends a bare `[]`: unticking everything saves
// the Dashboard floor, and the button says so before it's pressed.
const UNRESTRICTED_ROLES = ['Superadmin', 'Admin', 'Approver']
// What "restricted to nothing" actually resolves to. `/` is always viewable in
// canView terms only if granted, so it has to be written explicitly.
const FLOOR = ['/']

const PRESET_NOTES = {
  'Full access': 'Every page in the workspace — equivalent to leaving them unrestricted.',
  'Bookkeeping / AP': 'Invoice intake, payments and vendors, plus the finance reports.',
  'Finance exec': 'Reporting and money surfaces without the day-to-day AP queues.',
  Marketing: 'Campaigns, roster and releases — no financial pages.',
  'A&R': 'Pipeline, roster, releases and the contract trackers.',
  Legal: 'Contracts, NDAs, waivers and clearances only.',
}

export default function PermissionsManager() {
  const { toast } = useToast()
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [templates, setTemplates] = useState([])
  const [selId, setSelId] = useState('')
  const [pages, setPages] = useState(new Set())
  const [restricted, setRestricted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const [counts, setCounts] = useState({})
  const [delTarget, setDelTarget] = useState(null)

  const loadUsers = () => api.get('/team').then(r => setUsers(r.data.data || [])).catch(() => {})
  const loadTemplates = () => api.get('/settings/permission-templates').then(r => setTemplates(r.data.data || [])).catch(() => {})
  useEffect(() => { loadUsers(); loadTemplates() }, [])

  // Overview counts: one small request per member, fired once. Sequential on
  // purpose — a workspace roster is tens of people, and a burst of parallel
  // requests against the general rate limiter is a worse trade than a second
  // of latency on a panel nobody is blocked by.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const out = {}
      for (const u of users) {
        if (cancelled) return
        if (UNRESTRICTED_ROLES.includes(u.role)) { out[u.id] = null; continue }
        try { const { data } = await api.get(`/settings/permissions/${u.id}`); out[u.id] = (data.data || []).length }
        catch { out[u.id] = undefined }
      }
      if (!cancelled) setCounts(out)
    }
    if (users.length) run()
    return () => { cancelled = true }
  }, [users])

  const selected = users.find(u => String(u.id) === String(selId))
  const roleIsUnrestricted = selected && UNRESTRICTED_ROLES.includes(selected.role)
  // Only a Superadmin may write an admin-tier account's list (server enforces
  // the same rule) — hide the controls rather than let the save 403.
  const blockedByRole = selected && ['Superadmin', 'Admin'].includes(selected.role) && me?.role !== 'Superadmin'

  const pickUser = async (id) => {
    setSelId(id)
    setQuery('')
    setSavedAt(0)
    if (!id) { setPages(new Set()); setRestricted(false); return }
    try {
      const { data } = await api.get(`/settings/permissions/${id}`)
      const list = data.data || []
      setPages(new Set(list.length ? list : ALL_PAGES))
      setRestricted(list.length > 0)
    } catch { setPages(new Set()); setRestricted(false) }
  }

  const toggle = (path) => setPages(s => { const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n })
  const setGroup = (paths, on) => setPages(s => { const n = new Set(s); paths.forEach(p => on ? n.add(p) : n.delete(p)); return n })
  const applySet = (list) => { setPages(new Set(list)); setRestricted(list.length < ALL_PAGES.length) }

  const save = async () => {
    if (!selId) return
    setSaving(true)
    try {
      // Unrestricted → clear all rows. Restricted → always an explicit list,
      // with the Dashboard floor standing in for an empty selection.
      const list = [...pages]
      const payload = !restricted ? [] : (list.length ? list : FLOOR)
      await api.put(`/settings/permissions/${selId}`, { pages: payload })
      if (restricted && !list.length) setPages(new Set(FLOOR))
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(0), 3000)
      setCounts(c => ({ ...c, [selId]: restricted ? (list.length || FLOOR.length) : 0 }))
      toast('Permissions saved — their sessions were refreshed')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSaving(false) }
  }

  const saveAsTemplate = async () => {
    const name = window.prompt('Template name (e.g. "Marketing")')?.trim()
    if (!name) return
    const exists = templates.some(t => t.name.toLowerCase() === name.toLowerCase())
    try {
      await api.post('/settings/permission-templates', { name, pages: [...pages] })
      toast(`${exists ? 'Updated' : 'Saved'} template “${name}”`)
      loadTemplates()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const delTemplate = async () => {
    if (!delTarget) return
    try { await api.delete(`/settings/permission-templates/${delTarget.id}`); loadTemplates(); toast(`Deleted “${delTarget.name}”`) }
    catch { toast('Failed', 'error') }
    finally { setDelTarget(null) }
  }
  const copyFrom = async (id) => {
    if (!id) return
    try { const { data } = await api.get(`/settings/permissions/${id}`); applySet(data.data || ALL_PAGES); toast('Copied — review then Save') }
    catch { toast('Failed', 'error') }
  }

  const otherUsers = useMemo(() => users.filter(u => String(u.id) !== String(selId)), [users, selId])
  const q = query.trim().toLowerCase()
  const filteredGroups = useMemo(() => PAGE_GROUPS
    .map(g => ({ ...g, shown: q ? g.pages.filter(p => p.label.toLowerCase().includes(q) || p.path.includes(q)) : g.pages }))
    .filter(g => g.shown.length), [q])
  const noMatches = q && filteredGroups.length === 0

  const granted = pages.size
  const saveLabel = !restricted
    ? 'Save — unrestricted'
    : granted === 0 ? 'Save — Dashboard only' : `Save — ${granted} page${granted === 1 ? '' : 's'}`

  const countLabel = (u) => {
    if (UNRESTRICTED_ROLES.includes(u.role)) return 'Full access'
    const n = counts[u.id]
    if (n === undefined) return '…'
    return n === 0 ? 'Unrestricted' : `${n} page${n === 1 ? '' : 's'}`
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><ShieldCheck size={15} /> Permissions</h2>
      <p className="text-xs text-ink-muted mb-4">
        Control which pages a team member can see. Applies to <strong>User</strong> accounts — Admins, Superadmins and
        Approvers are unrestricted by role.
      </p>

      {/* Overview — every member and where they stand, so the panel says
          something before anyone is selected. */}
      {!selId && (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                <th className="px-2 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted">Member</th>
                <th className="px-2 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted">Role</th>
                <th className="px-2 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted">Department</th>
                <th className="px-2 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted">Access</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {users.length === 0 ? (
                <tr><td colSpan={5} className="px-2 py-6 text-center text-sm text-ink-muted">No members yet.</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className="hover:bg-brand-500/5">
                  <td className="px-2 py-2 font-medium text-ink">{u.name}</td>
                  <td className="px-2 py-2 text-ink-muted">{u.role}</td>
                  <td className="px-2 py-2 text-ink-muted">{u.department || '—'}</td>
                  <td className="px-2 py-2 text-ink-muted">{countLabel(u)}</td>
                  <td className="px-2 py-2 text-right">
                    <button onClick={() => pickUser(String(u.id))} className="text-xs font-semibold text-brand-ink hover:underline">Configure</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 mb-4 mt-4">
        <div>
          <label className="label" htmlFor="perm-member">Member</label>
          <select id="perm-member" className="input !w-56" value={selId} onChange={e => pickUser(e.target.value)}>
            <option value="">— select member —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
          </select>
        </div>
        {selId && !blockedByRole && (
          <>
            <div>
              <label className="label" htmlFor="perm-preset">Apply preset</label>
              <select id="perm-preset" className="input !w-48" value="" onChange={e => { const p = PERMISSION_PRESETS.find(x => x.name === e.target.value); if (p) applySet(p.pages) }}>
                <option value="">— preset —</option>
                {PERMISSION_PRESETS.map(p => <option key={p.name} value={p.name} title={PRESET_NOTES[p.name] || ''}>{p.name}</option>)}
              </select>
            </div>
            {templates.length > 0 && (
              <div>
                <label className="label" htmlFor="perm-template">Apply template</label>
                <select id="perm-template" className="input !w-44" value="" onChange={e => { const t = templates.find(x => String(x.id) === e.target.value); if (t) applySet(t.pages || []) }}>
                  <option value="">— template —</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({(t.pages || []).length})</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="perm-copy">Copy from</label>
              <select id="perm-copy" className="input !w-40" value="" onChange={e => copyFrom(e.target.value)}>
                <option value="">— user —</option>
                {otherUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      {selId && blockedByRole && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Only a Superadmin can set permissions for a {selected.role} account.
        </div>
      )}

      {selId && !blockedByRole && (
        <>
          {roleIsUnrestricted && (
            <div className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              {selected.role}s are unrestricted by role — this allow-list is stored but only takes effect if they become a User.
            </div>
          )}

          {/* Access level — the explicit answer to the ambiguous empty list. */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mr-1">Access</span>
            {[
              { on: false, label: 'Unrestricted', note: 'Sees every page, including ones added later.' },
              { on: true, label: 'Only selected pages', note: 'Sees exactly what is ticked below — nothing else.' },
            ].map(opt => (
              <button
                key={String(opt.on)}
                type="button"
                onClick={() => setRestricted(opt.on)}
                title={opt.note}
                aria-pressed={restricted === opt.on}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                  restricted === opt.on ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-ink-muted border-rule hover:border-gray-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className={restricted ? '' : 'opacity-50 pointer-events-none'} aria-hidden={!restricted}>
            <div className="relative mb-3 max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
              <input
                type="search"
                className="input !py-2 !pl-9"
                placeholder="Filter pages…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label="Filter pages"
              />
            </div>

            {noMatches ? (
              <p className="text-sm text-ink-muted py-6 text-center">No pages match “{query}”.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mb-4">
                {filteredGroups.map(g => {
                  const gp = g.pages.map(p => p.path)
                  const on = gp.filter(p => pages.has(p)).length
                  const isCollapsed = !!collapsed[g.group] && !q
                  return (
                    <div key={g.group}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <button
                          type="button"
                          onClick={() => setCollapsed(c => ({ ...c, [g.group]: !c[g.group] }))}
                          aria-expanded={!isCollapsed}
                          className="flex items-center gap-1 text-[11px] font-bold text-ink-muted uppercase tracking-wide hover:text-ink"
                        >
                          {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                          {g.group} <span className="font-semibold normal-case tracking-normal text-ink-faint">· {on} of {gp.length}</span>
                        </button>
                        <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold">
                          <button type="button" onClick={() => setGroup(gp, true)} className="text-brand-ink hover:underline">All</button>
                          <span className="text-ink-faint">/</span>
                          <button type="button" onClick={() => setGroup(gp, false)} className="text-ink-muted hover:text-ink hover:underline">None</button>
                        </span>
                      </div>
                      {!isCollapsed && (
                        <div className="space-y-1 pl-1">
                          {g.shown.map(p => {
                            const checked = pages.has(p.path)
                            return (
                              <button
                                key={p.path}
                                type="button"
                                onClick={() => toggle(p.path)}
                                aria-pressed={checked}
                                className="flex w-full items-center gap-2 text-sm text-ink text-left rounded px-1 py-0.5 hover:bg-brand-500/10"
                              >
                                <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-brand-600 border-brand-600' : 'border-gray-300'}`}>
                                  {checked && <Check size={11} className="text-white" />}
                                </span>
                                {p.label}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-divider">
            <button onClick={save} disabled={saving} className="btn-primary"><Save size={15} /> {saving ? 'Saving…' : saveLabel}</button>
            <button onClick={saveAsTemplate} disabled={!restricted || pages.size === 0} className="btn-secondary" title={restricted ? '' : 'Pick pages first'}>
              <Sparkles size={14} /> Save as template
            </button>
            {savedAt > 0 && <span className="inline-flex items-center gap-1 text-xs font-semibold text-success"><Check size={13} /> Saved</span>}
            <span className="text-xs text-ink-faint ml-auto">
              {restricted
                ? (granted === 0 ? 'Nothing ticked — they will see the Dashboard only.' : 'New pages added later are NOT granted automatically.')
                : 'They can open every page, including ones added later.'}
            </span>
          </div>
        </>
      )}

      {templates.length > 0 && (
        <div className="mt-4 pt-3 border-t border-divider">
          <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide mb-2">Saved templates</p>
          <div className="flex flex-wrap gap-1.5">
            {templates.map(t => (
              <span key={t.id} title={t.created_by ? `Created by ${t.created_by}` : undefined} className="inline-flex items-center gap-1 text-xs bg-gray-500/10 rounded px-2 py-1 text-ink">
                {t.name} <span className="text-ink-faint">({(t.pages || []).length})</span>
                <button onClick={() => setDelTarget(t)} aria-label={`Delete template ${t.name}`} className="text-ink-faint hover:text-danger"><Trash2 size={12} /></button>
              </span>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        onConfirm={delTemplate}
        title="Delete template"
        message={delTarget ? `Delete “${delTarget.name}”? Members already saved with it keep their pages — only the reusable template goes away.` : ''}
        confirmLabel="Delete template"
      />
    </div>
  )
}

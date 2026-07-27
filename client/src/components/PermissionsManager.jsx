import { useEffect, useMemo, useState } from 'react'
import { Check, Trash2, Save, Copy, Sparkles } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { PAGE_GROUPS, ALL_PAGES, PERMISSION_PRESETS } from '../constants/pages'

// Admin tool: edit a User's page allow-list, apply presets/templates, save the
// current set as a reusable template, and copy another user's set. Page
// permissions only bind Users — Admins/Superadmins/Approvers are unrestricted.
const UNRESTRICTED = ['Superadmin', 'Admin', 'Approver']

export default function PermissionsManager() {
  const { toast } = useToast()
  const [users, setUsers] = useState([])
  const [templates, setTemplates] = useState([])
  const [selId, setSelId] = useState('')
  const [pages, setPages] = useState(new Set())
  const [saving, setSaving] = useState(false)

  const loadUsers = () => api.get('/team').then(r => setUsers(r.data.data || [])).catch(() => {})
  const loadTemplates = () => api.get('/settings/permission-templates').then(r => setTemplates(r.data.data || [])).catch(() => {})
  useEffect(() => { loadUsers(); loadTemplates() }, [])

  const selected = users.find(u => String(u.id) === String(selId))
  const isUnrestricted = selected && UNRESTRICTED.includes(selected.role)

  const pickUser = async (id) => {
    setSelId(id)
    if (!id) { setPages(new Set()); return }
    try { const { data } = await api.get(`/settings/permissions/${id}`); setPages(new Set(data.data || [])) }
    catch { setPages(new Set()) }
  }

  const toggle = (path) => setPages(s => { const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n })
  const toggleGroup = (groupPaths, on) => setPages(s => { const n = new Set(s); groupPaths.forEach(p => on ? n.add(p) : n.delete(p)); return n })
  const applySet = (list) => setPages(new Set(list))

  const save = async () => {
    if (!selId) return
    setSaving(true)
    try {
      // A full set == unrestricted; store [] so new pages auto-grant.
      const list = [...pages]
      const payload = list.length >= ALL_PAGES.length ? [] : list
      await api.put(`/settings/permissions/${selId}`, { pages: payload })
      toast('Permissions saved — their sessions were refreshed')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSaving(false) }
  }

  const saveAsTemplate = async () => {
    const name = window.prompt('Template name (e.g. "Marketing")')?.trim()
    if (!name) return
    try { await api.post('/settings/permission-templates', { name, pages: [...pages] }); toast(`Saved template “${name}”`); loadTemplates() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const delTemplate = async (id) => { try { await api.delete(`/settings/permission-templates/${id}`); loadTemplates() } catch { toast('Failed', 'error') } }
  const copyFrom = async (id) => {
    if (!id) return
    try { const { data } = await api.get(`/settings/permissions/${id}`); applySet(data.data || []); toast('Copied — review then Save') }
    catch { toast('Failed', 'error') }
  }

  const grantedCount = pages.size
  const otherUsers = useMemo(() => users.filter(u => String(u.id) !== String(selId)), [users, selId])

  return (
    <div className="card p-5">
      <h2 className="text-sm font-bold text-ink mb-1">Permissions</h2>
      <p className="text-xs text-gray-400 mb-4">Control which pages a team member can see. Applies to <strong>User</strong> accounts — Admins, Superadmins and Approvers are unrestricted.</p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="label">Member</label>
          <select className="input !w-56" value={selId} onChange={e => pickUser(e.target.value)}>
            <option value="">— select member —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
          </select>
        </div>
        {selId && (
          <>
            <div>
              <label className="label">Apply preset</label>
              <select className="input !w-44" value="" onChange={e => { const p = PERMISSION_PRESETS.find(x => x.name === e.target.value); if (p) applySet(p.pages) }}>
                <option value="">— preset —</option>
                {PERMISSION_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            {templates.length > 0 && (
              <div>
                <label className="label">Apply template</label>
                <select className="input !w-44" value="" onChange={e => { const t = templates.find(x => String(x.id) === e.target.value); if (t) applySet(t.pages || []) }}>
                  <option value="">— template —</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">Copy from</label>
              <select className="input !w-40" value="" onChange={e => copyFrom(e.target.value)}>
                <option value="">— user —</option>
                {otherUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      {selId && (
        <>
          {isUnrestricted && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {selected.role}s are unrestricted — this allow-list is saved but only takes effect if their role becomes User.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mb-4">
            {PAGE_GROUPS.map(g => {
              const gp = g.pages.map(p => p.path)
              const all = gp.every(p => pages.has(p))
              return (
                <div key={g.group}>
                  <button type="button" onClick={() => toggleGroup(gp, !all)} className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5 hover:text-gray-600">
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${all ? 'bg-brand-600 border-brand-600' : 'border-gray-300'}`}>{all && <Check size={10} className="text-white" />}</span>
                    {g.group}
                  </button>
                  <div className="space-y-1 pl-1">
                    {g.pages.map(p => (
                      <label key={p.path} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${pages.has(p.path) ? 'bg-brand-600 border-brand-600' : 'border-gray-300'}`} onClick={() => toggle(p.path)}>{pages.has(p.path) && <Check size={11} className="text-white" />}</span>
                        <span onClick={() => toggle(p.path)}>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-divider">
            <button onClick={save} disabled={saving} className="btn-primary"><Save size={15} /> {saving ? 'Saving…' : `Save (${grantedCount} pages)`}</button>
            <button onClick={saveAsTemplate} className="btn-secondary"><Sparkles size={14} /> Save as template</button>
            <span className="text-xs text-gray-400 ml-auto">Grant everything to leave them unrestricted.</span>
          </div>
        </>
      )}

      {templates.length > 0 && (
        <div className="mt-4 pt-3 border-t border-divider">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Saved templates</p>
          <div className="flex flex-wrap gap-1.5">
            {templates.map(t => (
              <span key={t.id} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-2 py-1">
                {t.name} <span className="text-gray-400">({(t.pages || []).length})</span>
                <button onClick={() => delTemplate(t.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={12} /></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

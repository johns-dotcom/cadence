import { useEffect, useMemo, useState } from 'react'
import { Flag, ChevronDown, ChevronRight } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

export default function PlatformFeatureFlags() {
  const { toast } = useToast()
  const { user } = useAuth()
  const isOwner = user?.platform_role === 'owner'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  const load = () => { setLoading(true); api.get('/platform/feature-flags').then(r => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(load, [])

  // flag_key → { global: bool, byLabel: {labelId: bool} }
  const state = useMemo(() => {
    const s = {}
    for (const f of data?.registry || []) s[f.key] = { global: f.default, byLabel: {} }
    for (const o of data?.overrides || []) {
      if (!s[o.flag_key]) continue
      if (o.label_id === null) s[o.flag_key].global = o.enabled
      else s[o.flag_key].byLabel[o.label_id] = o.enabled
    }
    return s
  }, [data])

  const setGlobal = async (key, enabled) => {
    try { await api.patch('/platform/feature-flags', { key, enabled }); load() } catch { toast('Failed', 'error') }
  }
  const setWorkspace = async (key, labelId, value) => {
    try {
      if (value === 'default') await api.delete('/platform/feature-flags/workspace', { params: { key, label_id: labelId } })
      else await api.patch('/platform/feature-flags/workspace', { key, label_id: labelId, enabled: value === 'on' })
      load()
    } catch { toast('Failed', 'error') }
  }

  return (
    <div>
      <PageHeader title="Feature flags" subtitle="Turn capabilities on or off globally or per workspace" />

      {loading ? (
        <Skeleton.TaskList count={5} />
      ) : (
        <div className="space-y-2">
          {(data?.registry || []).map(f => {
            const st = state[f.key]
            const overrideCount = Object.keys(st.byLabel).length
            const open = expanded === f.key
            return (
              <div key={f.key} className="card overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${st.global ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}><Flag size={16} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink">{f.label}</p>
                    <p className="text-[11px] text-gray-400">{f.description}</p>
                    {overrideCount > 0 && <p className="text-[11px] text-brand-600 mt-0.5">{overrideCount} workspace override{overrideCount === 1 ? '' : 's'}</p>}
                  </div>
                  {/* Global toggle */}
                  <button
                    onClick={() => isOwner && setGlobal(f.key, !st.global)}
                    disabled={!isOwner}
                    title={isOwner ? 'Toggle globally' : 'Owner only'}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${st.global ? 'bg-emerald-500' : 'bg-gray-300'} ${!isOwner ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${st.global ? 'translate-x-5' : ''}`} />
                  </button>
                  <button onClick={() => setExpanded(open ? null : f.key)} className="text-gray-400 hover:text-gray-600 p-1 flex-shrink-0">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                </div>

                {open && (
                  <div className="border-t border-divider bg-page/40 px-4 py-3">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Per-workspace overrides</p>
                    <div className="space-y-1.5 max-h-72 overflow-y-auto">
                      {(data?.workspaces || []).map(w => {
                        const has = w.id in st.byLabel
                        const value = has ? (st.byLabel[w.id] ? 'on' : 'off') : 'default'
                        return (
                          <div key={w.id} className="flex items-center justify-between gap-3">
                            <span className="text-sm text-ink truncate">{w.name} {!has && <span className="text-[11px] text-gray-400">(default: {st.global ? 'on' : 'off'})</span>}</span>
                            <select value={value} onChange={e => setWorkspace(f.key, w.id, e.target.value)} disabled={!isOwner} className="text-[11px] font-medium border border-rule rounded-md px-1.5 py-1 bg-card text-gray-600 cursor-pointer flex-shrink-0">
                              <option value="default">Default</option>
                              <option value="on">On</option>
                              <option value="off">Off</option>
                            </select>
                          </div>
                        )
                      })}
                      {!data?.workspaces?.length && <p className="text-sm text-gray-400">No workspaces.</p>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {!isOwner && <p className="text-[11px] text-gray-400 mt-4">Only platform owners can change flags.</p>}
    </div>
  )
}

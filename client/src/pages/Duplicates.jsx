import { useEffect, useState } from 'react'
import { Merge, ShieldCheck, Users, Music, Building2 } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'

// Data-quality console: surfaces duplicate artists/releases/vendors and lets an
// admin merge them. Merges are server-side transactions scoped to the label.
export default function Duplicates() {
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = () => { setLoading(true); api.get('/flags').then(r => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(load, [])

  const merge = async (endpoint, body, label) => {
    if (!window.confirm(`${label}? This cannot be undone.`)) return
    setBusy(true)
    try { await api.post(`/flags/${endpoint}`, body); toast('Merged'); load() }
    catch (err) { toast(err.response?.data?.error || 'Merge failed', 'error') }
    finally { setBusy(false) }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>

  const { duplicate_artists = [], duplicate_releases = [], duplicate_vendors = [] } = data || {}
  const clean = !duplicate_artists.length && !duplicate_releases.length && !duplicate_vendors.length

  return (
    <div>
      <PageHeader title="Data quality" subtitle="Find and merge duplicate records in this workspace" />

      {clean ? (
        <div className="card p-10 text-center">
          <ShieldCheck size={28} className="text-emerald-500 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No duplicates detected. Your data is clean.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Artists */}
          {duplicate_artists.length > 0 && (
            <Section icon={Users} title="Duplicate artists" count={duplicate_artists.length}>
              {duplicate_artists.map(g => (
                <DupGroup key={g.key} items={g.items.map(i => i.name)}>
                  {g.items.map(src => g.items.filter(t => t.id !== src.id).map(tgt => (
                    <MergeBtn key={`${src.id}-${tgt.id}`} busy={busy}
                      onClick={() => merge('merge-artists', { source_id: src.id, target_id: tgt.id }, `Merge "${src.name}" into "${tgt.name}"`)}
                      label={`${src.name} → ${tgt.name}`} />
                  )))}
                </DupGroup>
              ))}
            </Section>
          )}

          {/* Releases */}
          {duplicate_releases.length > 0 && (
            <Section icon={Music} title="Duplicate releases" count={duplicate_releases.length}>
              {duplicate_releases.map(g => (
                <DupGroup key={g.key} items={g.items.map(i => `${i.name} (#${i.id})`)}>
                  {g.items.map(src => g.items.filter(t => t.id !== src.id).map(tgt => (
                    <MergeBtn key={`${src.id}-${tgt.id}`} busy={busy}
                      onClick={() => merge('merge-releases', { source_id: src.id, target_id: tgt.id }, `Merge release #${src.id} into #${tgt.id}`)}
                      label={`#${src.id} → #${tgt.id}`} />
                  )))}
                </DupGroup>
              ))}
            </Section>
          )}

          {/* Vendors */}
          {duplicate_vendors.length > 0 && (
            <Section icon={Building2} title="Similar vendor names" count={duplicate_vendors.length}>
              {duplicate_vendors.map(g => (
                <DupGroup key={g.key} items={g.names}>
                  {g.names.map(src => g.names.filter(t => t !== src).map(tgt => (
                    <MergeBtn key={`${src}-${tgt}`} busy={busy}
                      onClick={() => merge('merge-vendors', { source_name: src, target_name: tgt }, `Rename "${src}" to "${tgt}" everywhere`)}
                      label={`${src} → ${tgt}`} />
                  )))}
                </DupGroup>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ icon: Icon, title, count, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className="text-amber-600" />
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function DupGroup({ items, children }) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {items.map((it, i) => <span key={i} className="text-xs font-medium bg-gray-100 text-gray-700 px-2 py-1 rounded">{it}</span>)}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function MergeBtn({ onClick, label, busy }) {
  return (
    <button onClick={onClick} disabled={busy} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-rule text-gray-600 hover:bg-gray-50 disabled:opacity-50">
      <Merge size={12} /> {label}
    </button>
  )
}

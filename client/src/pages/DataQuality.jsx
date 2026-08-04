import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, GitMerge, Ban, RotateCcw, ExternalLink, Plus, X, AlertTriangle } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'

const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const SEV = { critical: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-500' }
const FLAG_LABEL = {
  unknown_artist: 'Unknown artist', casing: 'Casing variant', multi_name: 'Multiple names',
  missing_artist: 'Missing artist', artist_song_mismatch: 'Artist/song mismatch', missing_song: 'Missing song', missing_socials: 'Missing socials',
}

export default function DataQuality() {
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('release')
  const [norm, setNorm] = useState({ pattern: '', base_artist: '' })

  const load = useCallback(() => {
    setLoading(true)
    api.get('/flags').then(r => setData(r.data.data)).catch(() => toast('Failed to load', 'error')).finally(() => setLoading(false))
  }, [toast])
  useEffect(() => { load() }, [load])

  const merge = async (kind, body, label) => {
    if (!window.confirm(`Merge ${label}? This rewrites references and cannot be undone.`)) return
    try { await api.post(`/flags/merge-${kind}`, body); toast('Merged'); load() }
    catch (err) { toast(err.response?.data?.error || 'Merge failed', 'error') }
  }
  const dismiss = async (flag_key, kind) => { try { await api.post('/flags/dismiss', { flag_key, kind }); load() } catch { toast('Failed', 'error') } }
  const restore = async (flag_key) => { try { await api.post('/flags/restore', { flag_key }); load() } catch { toast('Failed', 'error') } }
  const addNorm = async () => {
    if (!norm.pattern.trim() || !norm.base_artist.trim()) { toast('Both fields required', 'error'); return }
    try { const { data: r } = await api.post('/flags/normalization', norm); toast(`Renamed ${r.data.expenses + r.data.deals} rows`); setNorm({ pattern: '', base_artist: '' }); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const delNorm = async (id) => { try { await api.delete(`/flags/normalization/${id}`); load() } catch { toast('Failed', 'error') } }

  if (loading) return <div><PageHeader title="Data Quality" /><div className="card p-6"><Skeleton.Block /></div></div>
  if (!data) return null
  const c = data.counts || {}
  const TABS = [
    ['release', 'Releases', c.release], ['artist', 'Artists', c.artist], ['vendor', 'Vendors', c.vendor],
    ['invoice', 'Invoices', c.invoice], ['flags', 'Ledger flags', c.artist_flags], ['normalize', 'Normalization', data.normalization_map.length], ['dismissed', 'Dismissed', data.dismissed.length],
  ]

  return (
    <div>
      <PageHeader title="Data Quality" subtitle="Find and fix duplicates, mismatches, and messy attribution" />

      <div className="flex flex-wrap items-center gap-1 mb-4">
        {TABS.map(([k, lbl, n]) => (
          <button key={k} onClick={() => setTab(k)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${tab === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            {lbl}{n ? <span className={`ml-1.5 ${tab === k ? 'opacity-80' : 'text-gray-400'}`}>{n}</span> : ''}
          </button>
        ))}
      </div>

      {tab === 'release' && <Section empty={!data.release_dupes.length} emptyText="No duplicate releases.">
        {data.release_dupes.map(g => (
          <GroupCard key={g.flag_key} title={g.items.map(i => i.name).join(' · ')} badge={`matched on ${g.reason}`} onDismiss={() => dismiss(g.flag_key, 'release')}>
            <MergePicker items={g.items.map(i => ({ id: i.id, label: `${i.name}${i.upc ? ` · UPC ${i.upc}` : ''}` }))} onMerge={(target, source) => merge('releases', { source_id: source, target_id: target }, 'these releases')} />
          </GroupCard>
        ))}
      </Section>}

      {tab === 'artist' && <Section empty={!data.artist_dupes.length} emptyText="No duplicate artists.">
        {data.artist_dupes.map(g => (
          <GroupCard key={g.flag_key} title={g.items.map(i => i.name).join(' · ')} onDismiss={() => dismiss(g.flag_key, 'artist')}>
            <MergePicker items={g.items.map(i => ({ id: i.id, label: i.name }))} onMerge={(target, source) => merge('artists', { source_id: source, target_id: target }, 'these artists')} />
          </GroupCard>
        ))}
      </Section>}

      {tab === 'vendor' && <Section empty={!data.vendor_dupes.length && !data.vendor_w9_mismatch.length} emptyText="No vendor issues.">
        {data.vendor_dupes.map(g => (
          <GroupCard key={g.flag_key} title={g.names.join(' · ')} badge="name variants" onDismiss={() => dismiss(g.flag_key, 'vendor')}>
            <VendorMerge names={g.names} onMerge={(target, source) => merge('vendors', { source_name: source, target_name: target }, `"${source}" → "${target}"`)} />
          </GroupCard>
        ))}
        {data.vendor_w9_mismatch.map(g => (
          <GroupCard key={g.flag_key} title={g.name} badge="W9 name mismatch" onDismiss={() => dismiss(g.flag_key, 'vendor')}>
            <p className="text-xs text-gray-500">Ledger payee <span className="font-medium text-ink">{g.name}</span> · W9 says <span className="font-medium text-ink">{g.w9_name}</span>.</p>
            <div className="mt-2"><VendorMerge names={[g.name, g.w9_name]} onMerge={(target, source) => merge('vendors', { source_name: source, target_name: target }, `"${source}" → "${target}"`)} /></div>
          </GroupCard>
        ))}
      </Section>}

      {tab === 'invoice' && <Section empty={!data.invoice_dupes.length} emptyText="No duplicate invoice numbers.">
        {[...data.invoice_dupes].sort((a, b) => ['critical', 'high', 'medium', 'low'].indexOf(a.severity) - ['critical', 'high', 'medium', 'low'].indexOf(b.severity)).map(g => (
          <GroupCard key={g.flag_key} title={`${g.vendor} · #${g.number}`} badge={<span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEV[g.severity]}`}>{g.severity}</span>} onDismiss={() => dismiss(g.flag_key, 'invoice')}>
            {g.items.length ? <div className="flex flex-col gap-1">
              {g.items.map(i => <div key={i.id} className="flex items-center justify-between text-xs"><span className="text-gray-500">{i.date ? new Date(i.date).toLocaleDateString() : ''}</span><span className="text-ink tabular-nums">{money(i.amount, i.currency)}</span><Link to={`/ledger?focus=${i.id}`} className="text-gray-400 hover:text-brand-600"><ExternalLink size={13} /></Link></div>)}
            </div> : <p className="text-xs text-gray-400">Same number seen across multiple vendors.</p>}
          </GroupCard>
        ))}
      </Section>}

      {tab === 'flags' && <Section empty={!data.artist_flags.length} emptyText="No ledger attribution flags.">
        {Object.entries(data.artist_flags.reduce((g, f) => { (g[f.type] = g[f.type] || []).push(f); return g }, {})).map(([type, items]) => (
          <div key={type} className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><AlertTriangle size={14} className="text-amber-500" /> {FLAG_LABEL[type] || type} <span className="text-gray-400 font-normal">{items.length}</span></h3>
            </div>
            <div className="divide-y divide-divider">
              {items.map(f => (
                <div key={f.flag_key} className="flex items-center gap-2 py-1.5 text-xs">
                  <span className="text-ink flex-1 truncate">{f.payee || '—'}{f.artist ? ` · ${f.artist}` : ''}{f.song ? ` · ${f.song}` : ''}<span className="text-gray-400"> — {f.detail}</span></span>
                  <Link to={`/ledger?focus=${f.id}`} title="Fix in ledger" className="text-gray-400 hover:text-brand-600"><ExternalLink size={13} /></Link>
                  <button onClick={() => dismiss(f.flag_key, 'artist_flag')} title="This one's fine" className="text-gray-300 hover:text-danger"><Ban size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>}

      {tab === 'normalize' && (
        <div className="card p-5">
          <h3 className="text-sm font-bold text-ink mb-1">Artist normalization</h3>
          <p className="text-xs text-gray-400 mb-4">Map a collab / variant string to a base artist. Applying it renames every matching ledger + deal row now, and the rule is remembered.</p>
          <div className="flex flex-wrap items-end gap-2 mb-4">
            <div><label className="label">Collab / variant string</label><input className="input" value={norm.pattern} onChange={e => setNorm(n => ({ ...n, pattern: e.target.value }))} placeholder="Artist A & Artist B" /></div>
            <div><label className="label">Base artist</label><input className="input" value={norm.base_artist} onChange={e => setNorm(n => ({ ...n, base_artist: e.target.value }))} placeholder="Artist A" /></div>
            <button onClick={addNorm} className="btn-primary"><Plus size={15} /> Apply & remember</button>
          </div>
          <div className="divide-y divide-divider">
            {data.normalization_map.length ? data.normalization_map.map(m => (
              <div key={m.id} className="flex items-center justify-between py-2 text-sm"><span className="text-gray-600">"{m.pattern}" → <span className="font-medium text-ink">{m.base_artist}</span></span><button onClick={() => delNorm(m.id)} className="text-gray-300 hover:text-danger"><X size={14} /></button></div>
            )) : <p className="text-xs text-gray-400">No normalization rules yet.</p>}
          </div>
        </div>
      )}

      {tab === 'dismissed' && <Section empty={!data.dismissed.length} emptyText="Nothing dismissed.">
        <div className="card divide-y divide-divider">
          {data.dismissed.map(d => (
            <div key={d.flag_key} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div><span className="text-gray-600 font-mono text-xs">{d.flag_key}</span><span className="text-[11px] text-gray-400 ml-2">{d.kind} · {d.dismissed_by}</span></div>
              <button onClick={() => restore(d.flag_key)} className="text-xs font-semibold text-brand-600 hover:underline inline-flex items-center gap-1"><RotateCcw size={13} /> Restore</button>
            </div>
          ))}
        </div>
      </Section>}
    </div>
  )
}

function Section({ empty, emptyText, children }) {
  if (empty) return <div className="card p-10 text-center"><ShieldCheck size={28} className="text-emerald-400 mx-auto mb-3" /><p className="text-sm text-gray-500">{emptyText}</p></div>
  return <div className="space-y-3">{children}</div>
}
function GroupCard({ title, badge, onDismiss, children }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div><p className="font-medium text-ink text-sm">{title}</p>{badge && <span className="text-[10px] text-gray-400 uppercase tracking-wide">{badge}</span>}</div>
        <button onClick={onDismiss} title="Dismiss this group" className="text-gray-300 hover:text-danger flex-shrink-0"><Ban size={15} /></button>
      </div>
      {children}
    </div>
  )
}
// Pick a survivor (target); every other item merges into it.
function MergePicker({ items, onMerge }) {
  const [target, setTarget] = useState(items[0]?.id)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500">Keep:</span>
      <select value={target} onChange={e => setTarget(Number(e.target.value))} className="input !py-1 text-sm !w-auto">
        {items.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
      </select>
      <button onClick={() => items.filter(i => i.id !== target).forEach(i => onMerge(target, i.id))} className="btn-secondary !py-1 text-xs"><GitMerge size={13} /> Merge rest in</button>
    </div>
  )
}
function VendorMerge({ names, onMerge }) {
  const [target, setTarget] = useState(names[0])
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500">Keep:</span>
      <select value={target} onChange={e => setTarget(e.target.value)} className="input !py-1 text-sm !w-auto">
        {names.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <button onClick={() => names.filter(n => n !== target).forEach(n => onMerge(target, n))} className="btn-secondary !py-1 text-xs"><GitMerge size={13} /> Merge rest in</button>
    </div>
  )
}

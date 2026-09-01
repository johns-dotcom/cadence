import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Pencil, Download, X, Music, FileSpreadsheet, ChevronDown, ChevronRight, Library, Search, Link2, Loader } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'

// The 16 per-track detail fields, in the same order (and with the same keys)
// as server/lib/clearanceXlsx.js SUB_FIELDS — the chart renders them row for
// row, so the two lists must not drift. Blank here means "TBD" on the chart.
const SUB_FIELDS = [
  ['isrc', 'ISRC'],
  ['timing', 'Timing'],
  ['explicit', 'Clean or Explicit'],
  ['samples_ai', 'Samples / AI?'],
  ['produced_by', 'Produced by'],
  ['musician_credits', 'Musician Credits'],
  ['recorded_by', 'Recorded by'],
  ['mixed_by', 'Mixed by'],
  ['mastered_by', 'Mastered by'],
  ['writers', 'Writers (full names)'],
  ['publishing_splits', 'Publishing splits'],
  ['publishers', 'Publishers'],
  ['lyrics', 'Lyrics'],
  ['stems_masters', 'Stems / Masters?'],
  ['artwork', 'Artwork?'],
  ['credits_approved', 'Credits Approved?'],
]

// The primary row of each track block — these are the columns that run across
// the chart next to the track title.
const PRIMARY_FIELDS = [
  ['role', 'Role'],
  ['credit', 'Credit'],
  ['docs_needed', 'Docs needed'],
  ['sample_review', 'Sample review'],
  ['release_date', 'Release date'],
  ['royalty_comments', 'Royalty comments'],
  ['royalty_rate', 'Royalty rate'],
  ['royalty_account', 'Royalty account'],
  ['advance', 'Advance'],
  ['recoupable_portion', 'Recoupable portion'],
  ['agreement_on_file', 'Agreement on file'],
]

const blankTrack = () => ({
  release_id: null,                       // FK back to releases when picked from catalog
  title: '',
  ...Object.fromEntries(PRIMARY_FIELDS.map(([k]) => [k, ''])),
  ...Object.fromEntries(SUB_FIELDS.map(([k]) => [k, ''])),
})

const BLANK = {
  artist_id: '', title: '', project_number: '', product_commitment: '',
  contractual_members: '', effective_date: '', royalty_rate: '', royalty_account: '',
  tracks: [blankTrack()],
}

// Project a catalog release onto a track, preserving anything the user already
// typed. The catalog only knows 5 of the ~28 fields the chart needs — the rest
// keep their manual values (or stay blank → TBD).
function applyReleaseToTrack(existing, release) {
  return {
    ...existing,
    release_id: release.id,
    title: release.project_name || existing.title || '',
    release_date: release.release_date ? String(release.release_date).slice(0, 10) : (existing.release_date || ''),
    isrc: release.isrc || existing.isrc || '',
    produced_by: release.producer || existing.produced_by || '',
    credit: release.featured_artists || existing.credit || '',
  }
}

export default function ArtistClearance() {
  const { toast } = useToast()
  const [list, setList] = useState([])
  const [artists, setArtists] = useState([])
  const [catalog, setCatalog] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Multiple tracks open at once — a 12-track EP is edited by comparing rows,
  // not by opening one at a time. First track open by default.
  const [expanded, setExpanded] = useState(new Set([0]))
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkPicks, setBulkPicks] = useState(new Set())
  const [bulkSearch, setBulkSearch] = useState('')

  const load = () => api.get('/clearances')
    .then(r => { setList(r.data.data || []); setError('') })
    .catch(err => setError(err?.response?.data?.error || 'Could not load clearances'))
  useEffect(() => {
    Promise.all([
      load(),
      // /artists already defaults to a 1000-row page — no limit param needed.
      api.get('/artists').then(r => setArtists(r.data.data || [])).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  // Reload the artist's catalog whenever the artist changes — it feeds both
  // the title autocomplete and the bulk picker.
  useEffect(() => {
    if (!form.artist_id) { setCatalog([]); return }
    setCatalogLoading(true)
    api.get('/clearances/catalog', { params: { artist_id: form.artist_id } })
      .then(r => setCatalog(r.data.data || []))
      .catch(() => setCatalog([]))
      .finally(() => setCatalogLoading(false))
  }, [form.artist_id])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setTrack = (i, k, val) => setForm(f => ({ ...f, tracks: f.tracks.map((t, j) => j === i ? { ...t, [k]: val } : t) }))
  const addTrack = () => {
    setForm(f => ({ ...f, tracks: [...f.tracks, blankTrack()] }))
    setExpanded(prev => new Set([...prev, form.tracks.length]))
  }
  // Never drop the last track — a clearance with zero tracks is a chart with
  // nothing to clear.
  const removeTrack = (i) => setForm(f => ({ ...f, tracks: f.tracks.length === 1 ? f.tracks : f.tracks.filter((_, j) => j !== i) }))
  const bindTrack = (i, release) => setForm(f => ({ ...f, tracks: f.tracks.map((t, j) => j === i ? applyReleaseToTrack(t, release) : t) }))
  const unbindTrack = (i) => setForm(f => ({ ...f, tracks: f.tracks.map((t, j) => j === i ? { ...t, release_id: null } : t) }))
  const toggleExpand = (i) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i); else next.add(i)
    return next
  })
  const toggleBulkPick = (id) => setBulkPicks(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  // Bulk-add: if the only track is the untouched default blank, the picks
  // replace it rather than leaving an empty row at the top.
  const addPickedFromCatalog = () => {
    const picks = catalog.filter(r => bulkPicks.has(r.id))
    if (!picks.length) return
    setForm(f => {
      const base = (f.tracks.length === 1 && !f.tracks[0].title && !f.tracks[0].release_id) ? [] : f.tracks
      return { ...f, tracks: [...base, ...picks.map(r => applyReleaseToTrack(blankTrack(), r))] }
    })
    setBulkPicks(new Set()); setBulkSearch(''); setBulkOpen(false)
  }

  const reset = () => { setForm(BLANK); setEditingId(null); setExpanded(new Set([0])); setError('') }
  const edit = (c) => {
    setEditingId(c.id)
    setForm({
      ...BLANK, ...c,
      artist_id: c.artist_id || '',
      effective_date: c.effective_date ? c.effective_date.slice(0, 10) : '',
      tracks: (Array.isArray(c.tracks) && c.tracks.length) ? c.tracks : [blankTrack()],
    })
    setExpanded(new Set([0]))
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async () => {
    setError('')
    if (!form.artist_id) { setError('Pick an artist'); return }
    setSaving(true)
    try {
      const payload = { ...form, artist_id: parseInt(form.artist_id, 10) }
      if (editingId) await api.put(`/clearances/${editingId}`, payload)
      else await api.post('/clearances', payload)
      toast(editingId ? 'Clearance updated' : 'Clearance saved'); reset(); load()
    } catch (err) { setError(err.response?.data?.error || 'Failed to save') }
    finally { setSaving(false) }
  }
  const remove = async (id) => {
    if (!window.confirm("Delete this clearance + remove the chart from the artist's Documents tab?")) return
    try { await api.delete(`/clearances/${id}`); if (editingId === id) reset(); load() } catch { toast('Failed', 'error') }
  }
  const download = async (c) => {
    try {
      const res = await api.get(`/clearances/${c.id}/download`, { responseType: 'blob' })
      // Prefer the server's own Content-Disposition name; fall back to the
      // stored filename, then to a constructed one. Never a generic default —
      // every chart saving as "clearance.xlsx" is unusable in a downloads folder.
      const cd = res.headers?.['content-disposition'] || ''
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)
      const name = (match && decodeURIComponent(match[1]))
        || c.file_filename
        || `Clearance-${(c.artist_name || 'artist').replace(/[^a-z0-9]+/gi, '_')}-${(c.title || 'untitled').replace(/[^a-z0-9]+/gi, '_')}.xlsx`
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a'); a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
    } catch { toast('Download failed', 'error') }
  }

  if (loading) return <div className="space-y-6"><Skeleton.Block h="h-24" /><Skeleton.Block h="h-64" /></div>

  const artistName = artists.find(a => String(a.id) === String(form.artist_id))?.name || ''
  const filteredCatalog = catalog.filter(r => !bulkSearch.trim() || (r.project_name || '').toLowerCase().includes(bulkSearch.trim().toLowerCase()))

  return (
    <div>
      <PageHeader title="Clearances" subtitle="Per-track rights & credit charts — exported to Excel" />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 card p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-ink">{editingId ? `Edit clearance #${editingId}` : 'New artist clearance chart'}</h2>
            {editingId && <button onClick={reset} className="text-xs font-medium text-ink-muted hover:text-ink">Cancel edit</button>}
          </div>
          <p className="text-xs text-ink-muted mb-5">
            Saving generates the XLSX chart and files it on the artist's <strong className="text-ink">Documents</strong> tab automatically.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <div>
              <label className="label">Artist <span className="text-danger">*</span></label>
              <select className="input" required value={form.artist_id} onChange={set('artist_id')}>
                <option value="">— pick an artist —</option>
                {artists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div><label className="label">Effective date</label><input type="date" className="input" value={form.effective_date} onChange={set('effective_date')} /></div>
            <div><label className="label">Project #</label><input className="input" value={form.project_number} onChange={set('project_number')} /></div>
            <div><label className="label">Title</label><input className="input" value={form.title} onChange={set('title')} placeholder="EP / Album / Single name" /></div>
            <div><label className="label">Product commitment</label><input className="input" value={form.product_commitment} onChange={set('product_commitment')} placeholder="e.g. 1 EP, 2 singles" /></div>
            <div><label className="label">Contractual members</label><input className="input" value={form.contractual_members} onChange={set('contractual_members')} /></div>
            <div><label className="label">Main artist royalty account</label><input className="input" value={form.royalty_account} onChange={set('royalty_account')} /></div>
            <div><label className="label">Artist royalty rate</label><input className="input" value={form.royalty_rate} onChange={set('royalty_rate')} placeholder="e.g. 50%" /></div>
          </div>

          {/* Tracks */}
          <div className="flex items-center justify-between mb-2 gap-2">
            <h3 className="text-sm font-semibold text-ink">Tracks ({form.tracks.length})</h3>
            <div className="flex items-center gap-1.5">
              {form.artist_id && catalog.length > 0 && (
                <button
                  onClick={() => setBulkOpen(v => !v)}
                  title="Pick one or more releases from this artist's catalog to add as tracks"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-brand-ink border border-brand-500/30 rounded-lg bg-brand-500/10 hover:bg-brand-500/20"
                >
                  <Library size={12} /> From catalog ({catalog.length})
                </button>
              )}
              <button onClick={addTrack} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-ink-muted hover:text-ink border border-rule rounded-lg">
                <Plus size={12} /> Blank track
              </button>
            </div>
          </div>

          {bulkOpen && (
            <div className="mb-3 border border-rule rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-divider flex items-center gap-2">
                <Search size={13} className="text-ink-faint" />
                <input value={bulkSearch} onChange={e => setBulkSearch(e.target.value)} placeholder="Filter catalog by track title…" className="flex-1 text-sm bg-transparent focus:outline-none text-ink" />
                {catalogLoading && <Loader size={12} className="animate-spin text-ink-faint" />}
                <button onClick={() => { setBulkOpen(false); setBulkPicks(new Set()); setBulkSearch('') }} className="p-1 text-ink-faint hover:text-ink"><X size={13} /></button>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-divider">
                {filteredCatalog.map(r => {
                  const already = form.tracks.some(t => t.release_id === r.id)
                  return (
                    <label key={r.id} className={`flex items-center gap-2.5 px-3 py-2 text-xs ${already ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-brand-500/10'}`}>
                      <input type="checkbox" checked={bulkPicks.has(r.id)} disabled={already} onChange={() => !already && toggleBulkPick(r.id)} />
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-ink truncate">{r.project_name}</span>
                        <span className="block text-[10px] text-ink-muted">
                          {[r.release_date && String(r.release_date).slice(0, 10), r.release_type, r.genre, r.isrc, r.producer && `prod. ${r.producer}`].filter(Boolean).join(' · ')}
                          {already && <span className="text-brand-ink font-semibold"> · already added</span>}
                        </span>
                      </span>
                    </label>
                  )
                })}
                {!filteredCatalog.length && !catalogLoading && <div className="px-3 py-4 text-center text-xs text-ink-muted">No releases in catalog for this artist.</div>}
              </div>
              <div className="px-3 py-2 border-t border-divider flex items-center justify-between">
                <span className="text-[11px] text-ink-muted">{bulkPicks.size} selected</span>
                <button onClick={addPickedFromCatalog} disabled={!bulkPicks.size} className="btn-primary !py-1 !px-3 !text-xs">
                  Add {bulkPicks.size} track{bulkPicks.size === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3 mb-4">
            {form.tracks.map((t, i) => {
              const isOpen = expanded.has(i)
              return (
                <div key={i} className="border border-rule rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-elev border-b border-divider">
                    <button onClick={() => toggleExpand(i)} className="p-1 text-ink-faint hover:text-ink">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                    <Music size={13} className="text-ink-faint" />
                    <span className="text-xs font-bold text-ink-muted tabular-nums">#{i + 1}</span>
                    <TrackTitleInput
                      track={t}
                      catalog={catalog}
                      excludeIds={new Set(form.tracks.filter((_, j) => j !== i).map(x => x.release_id).filter(Boolean))}
                      onTitleChange={(v) => setTrack(i, 'title', v)}
                      onPickRelease={(r) => bindTrack(i, r)}
                      onUnlink={() => unbindTrack(i)}
                    />
                    {form.tracks.length > 1 && (
                      <button onClick={() => removeTrack(i)} title="Remove track" className="p-1 text-ink-faint hover:text-danger"><Trash2 size={13} /></button>
                    )}
                  </div>
                  {isOpen && (
                    <div className="p-3 space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {PRIMARY_FIELDS.map(([k, lbl]) => (
                          <div key={k}>
                            <label className="label !text-[10px] !mb-0.5">{lbl}</label>
                            <input className="input !py-1 !text-xs" value={t[k] || ''} onChange={e => setTrack(i, k, e.target.value)} />
                          </div>
                        ))}
                      </div>
                      <div className="pt-3 border-t border-divider">
                        <div className="text-[10px] font-bold text-ink-faint uppercase tracking-wider mb-2">Track details (blank → TBD in the chart)</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {SUB_FIELDS.map(([k, lbl]) => (
                            <div key={k}>
                              <label className="label !text-[10px] !mb-0.5">{lbl}</label>
                              <input className="input !py-1 !text-xs" placeholder="TBD" value={t[k] || ''} onChange={e => setTrack(i, k, e.target.value)} />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {error && <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 mb-3">{error}</div>}

          <div className="flex justify-end gap-2">
            {editingId && <button onClick={reset} className="btn-secondary">Cancel</button>}
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : (editingId ? 'Update clearance' : 'Save clearance')}</button>
          </div>
          <p className="text-[11px] text-ink-faint text-right mt-2">The generated XLSX is filed on the artist's Documents tab. Updates replace the same file.</p>
        </div>

        {/* Chart preview */}
        <div className="xl:col-span-1">
          <div className="card p-5 sticky top-4">
            <div className="flex items-center gap-2 mb-3">
              <FileSpreadsheet size={16} className="text-brand-ink" />
              <h3 className="text-sm font-semibold text-ink">Chart preview</h3>
            </div>
            <div className="space-y-2.5 text-[12px]">
              <PreviewRow label="Artist" value={artistName || '—'} />
              <PreviewRow label="Title" value={form.title || '—'} />
              <PreviewRow label="Project #" value={form.project_number || '—'} />
              <PreviewRow label="Product commitment" value={form.product_commitment || '—'} />
              <PreviewRow label="Effective date" value={form.effective_date || '—'} />
              <PreviewRow label="Members" value={form.contractual_members || '—'} />
              <PreviewRow label="Royalty rate" value={form.royalty_rate || '—'} />
            </div>
            <div className="mt-4 pt-3 border-t border-divider">
              <div className="text-[10px] font-bold text-ink-faint uppercase tracking-wider mb-2">Tracks ({form.tracks.length})</div>
              <ol className="space-y-1 text-[12px]">
                {form.tracks.map((t, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="text-ink-faint tabular-nums">{i + 1}.</span>
                    <span className="text-ink-muted truncate">{t.title || <em className="text-ink-faint">untitled</em>}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>

      {/* Saved list */}
      {list.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-bold text-ink mb-3">Saved clearances ({list.length})</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] text-ink-faint uppercase tracking-wide border-b border-divider bg-elev">
                <th className="px-4 py-2.5 font-semibold">Artist</th><th className="px-4 py-2.5 font-semibold">Title</th><th className="px-4 py-2.5 font-semibold">Tracks</th><th className="px-4 py-2.5 font-semibold">Updated</th><th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr></thead>
              <tbody>
                {list.map(c => (
                  <tr key={c.id} className="border-b border-divider last:border-0 hover:bg-brand-500/10">
                    <td className="px-4 py-3 font-medium text-ink">{c.artist_name || '—'}</td>
                    <td className="px-4 py-3 text-ink-muted">{c.title || '—'}</td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums">{c.track_count}</td>
                    <td className="px-4 py-3 text-ink-faint text-xs">{formatDate(c.updated_at || c.created_at)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => edit(c)} title="Edit" className="text-ink-faint hover:text-brand-ink px-1.5"><Pencil size={14} /></button>
                      <button onClick={() => download(c)} title="Download XLSX" className="text-ink-faint hover:text-ink px-1.5"><Download size={14} /></button>
                      <button onClick={() => remove(c.id)} title="Delete" className="text-ink-faint hover:text-danger px-1.5"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function PreviewRow({ label, value }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-semibold text-ink-faint uppercase tracking-wide w-28 flex-shrink-0">{label}</span>
      <span className="text-ink truncate">{value}</span>
    </div>
  )
}

// Searchable title input. Typing filters the artist's catalog; picking a
// suggestion binds the track to that release and fills what the catalog knows.
// Editing the title after binding unlinks — the user is clearly typing
// something custom, so the row shouldn't keep claiming it's linked. Releases
// already used by a sibling track are hidden so one release attaches once.
function TrackTitleInput({ track, catalog, excludeIds, onTitleChange, onPickRelease, onUnlink }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const linked = !!track.release_id
  const query = (track.title || '').toLowerCase().trim()
  const suggestions = (catalog || [])
    .filter(r => !excludeIds.has(r.id))
    .filter(r => !query || (r.project_name || '').toLowerCase().includes(query))
    .slice(0, 8)

  return (
    <div ref={wrapRef} className="relative flex-1 flex items-center gap-1.5">
      <input
        value={track.title}
        onChange={e => {
          if (linked && e.target.value !== track.title) onUnlink()
          onTitleChange(e.target.value)
          if (!open) setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Track title — type to search catalog…"
        className="input !py-1 flex-1 min-w-0"
      />
      {linked && (
        <button
          onClick={(e) => { e.stopPropagation(); onUnlink() }}
          title="Linked to a catalog release — click to unlink"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-brand-500/15 text-brand-ink border border-brand-500/30"
        >
          <Link2 size={10} /> Linked
        </button>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-10 top-full mt-1 z-20 bg-card border border-rule rounded-lg shadow-modal max-h-72 overflow-y-auto">
          {suggestions.map(r => {
            const exact = (r.project_name || '').toLowerCase() === query
            return (
              <button
                key={r.id}
                onMouseDown={(e) => { e.preventDefault(); onPickRelease(r); setOpen(false) }}
                className="w-full text-left px-3 py-2 hover:bg-brand-500/10 border-b border-divider last:border-b-0"
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-ink truncate">{r.project_name}</span>
                  {exact && <span className="text-[9px] font-bold text-brand-ink bg-brand-500/15 px-1 rounded">EXACT MATCH</span>}
                </span>
                <span className="block text-[10px] text-ink-muted mt-0.5">
                  {[r.release_date && String(r.release_date).slice(0, 10), r.release_type, r.isrc, r.producer && `prod. ${r.producer}`].filter(Boolean).join(' · ')}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

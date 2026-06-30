import { useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, Download, X, Music, FileSpreadsheet, ChevronDown, ChevronRight } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'

const BLANK = { artist_id: '', title: '', project_number: '', product_commitment: '', contractual_members: '', effective_date: '', royalty_rate: '', royalty_account: '', tracks: [] }
const TRACK_FIELDS = [
  ['isrc', 'ISRC'], ['timing', 'Timing'], ['explicit', 'Explicit'], ['samples_ai', 'Samples / AI'],
  ['produced_by', 'Produced by'], ['writers', 'Writers'], ['publishing_splits', 'Publishing splits'],
  ['publishers', 'Publishers'], ['mixed_by', 'Mixed by'], ['mastered_by', 'Mastered by'],
  ['royalty_rate', 'Royalty rate'], ['agreement_on_file', 'Agreement on file'],
]
const blankTrack = () => ({ title: '', credit: '', isrc: '', timing: '', explicit: '', samples_ai: '', produced_by: '', writers: '', publishing_splits: '', publishers: '', mixed_by: '', mastered_by: '', royalty_rate: '', agreement_on_file: '' })

export default function ArtistClearance() {
  const { toast } = useToast()
  const [list, setList] = useState([])
  const [artists, setArtists] = useState([])
  const [catalog, setCatalog] = useState([])
  const [form, setForm] = useState(BLANK)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [openTrack, setOpenTrack] = useState(0)

  const load = () => api.get('/clearances').then(r => setList(r.data.data || [])).catch(() => {})
  useEffect(() => { load(); api.get('/artists').then(r => setArtists(r.data.data || [])).catch(() => {}) }, [])
  useEffect(() => {
    if (!form.artist_id) { setCatalog([]); return }
    api.get('/clearances/catalog', { params: { artist_id: form.artist_id } }).then(r => setCatalog(r.data.data || [])).catch(() => {})
  }, [form.artist_id])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setTrack = (i, k, val) => setForm(f => ({ ...f, tracks: f.tracks.map((t, j) => j === i ? { ...t, [k]: val } : t) }))
  const addTrack = (preset) => { setForm(f => ({ ...f, tracks: [...f.tracks, { ...blankTrack(), ...preset }] })); setOpenTrack(form.tracks.length) }
  const removeTrack = (i) => setForm(f => ({ ...f, tracks: f.tracks.filter((_, j) => j !== i) }))
  const addFromCatalog = (r) => addTrack({ title: r.project_name, isrc: r.isrc || '', produced_by: r.producer || '' })

  const reset = () => { setForm(BLANK); setEditingId(null); setOpenTrack(0) }
  const edit = (c) => {
    setEditingId(c.id)
    setForm({ ...BLANK, ...c, artist_id: c.artist_id || '', effective_date: c.effective_date ? c.effective_date.slice(0, 10) : '', tracks: Array.isArray(c.tracks) ? c.tracks : [] })
    setOpenTrack(0)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async () => {
    if (!form.artist_id) { toast('Pick an artist', 'error'); return }
    setSaving(true)
    try {
      const payload = { ...form, artist_id: form.artist_id }
      if (editingId) await api.put(`/clearances/${editingId}`, payload)
      else await api.post('/clearances', payload)
      toast(editingId ? 'Clearance updated' : 'Clearance saved'); reset(); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed to save', 'error') }
    finally { setSaving(false) }
  }
  const remove = async (id) => {
    if (!window.confirm('Delete this clearance?')) return
    try { await api.delete(`/clearances/${id}`); if (editingId === id) reset(); load() } catch { toast('Failed', 'error') }
  }
  const download = async (id) => {
    try {
      const res = await api.get(`/clearances/${id}/download`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a'); a.href = url; a.download = 'clearance.xlsx'
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
    } catch { toast('Download failed', 'error') }
  }

  return (
    <div>
      <PageHeader title="Clearances" subtitle="Per-track rights & credit charts — exported to Excel" />

      <div className="card p-5 mb-6">
        <h2 className="text-sm font-bold text-ink mb-4">{editingId ? 'Edit clearance' : 'New clearance'}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div><label className="label">Artist</label><select className="input" value={form.artist_id} onChange={set('artist_id')}><option value="">— select —</option>{artists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div><label className="label">Title</label><input className="input" value={form.title} onChange={set('title')} placeholder="EP / album / single" /></div>
          <div><label className="label">Project #</label><input className="input" value={form.project_number} onChange={set('project_number')} /></div>
          <div><label className="label">Effective date</label><input type="date" className="input" value={form.effective_date} onChange={set('effective_date')} /></div>
          <div><label className="label">Product commitment</label><input className="input" value={form.product_commitment} onChange={set('product_commitment')} placeholder="e.g. 1 EP, 2 singles" /></div>
          <div><label className="label">Artist royalty rate</label><input className="input" value={form.royalty_rate} onChange={set('royalty_rate')} placeholder="e.g. 50%" /></div>
          <div className="sm:col-span-2"><label className="label">Contractual members</label><input className="input" value={form.contractual_members} onChange={set('contractual_members')} /></div>
          <div><label className="label">Royalty account</label><input className="input" value={form.royalty_account} onChange={set('royalty_account')} /></div>
        </div>

        {/* Tracks */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-ink">Tracks ({form.tracks.length})</h3>
          <button onClick={() => addTrack()} className="text-xs font-semibold text-brand-600 hover:underline inline-flex items-center gap-1"><Plus size={13} /> Blank track</button>
        </div>
        {form.artist_id && catalog.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <span className="text-[11px] text-gray-400 self-center">From catalog:</span>
            {catalog.map(r => <button key={r.id} onClick={() => addFromCatalog(r)} className="text-[11px] bg-gray-100 hover:bg-gray-200 rounded px-2 py-1">{r.project_name}</button>)}
          </div>
        )}
        <div className="space-y-2 mb-4">
          {form.tracks.map((t, i) => (
            <div key={i} className="border border-rule rounded-lg">
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => setOpenTrack(openTrack === i ? -1 : i)} className="text-gray-400">{openTrack === i ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
                <Music size={14} className="text-gray-400" />
                <span className="text-xs text-gray-400">{i + 1}.</span>
                <input className="input !py-1 flex-1" value={t.title} onChange={e => setTrack(i, 'title', e.target.value)} placeholder="Track title" />
                <button onClick={() => removeTrack(i)} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
              {openTrack === i && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-3 pb-3">
                  <div className="sm:col-span-2"><label className="label">Credit</label><input className="input !py-1.5" value={t.credit || ''} onChange={e => setTrack(i, 'credit', e.target.value)} /></div>
                  {TRACK_FIELDS.map(([k, lbl]) => (
                    <div key={k}><label className="label">{lbl}</label><input className="input !py-1.5" value={t[k] || ''} onChange={e => setTrack(i, k, e.target.value)} /></div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!form.tracks.length && <p className="text-sm text-gray-400">No tracks yet — add a blank track or pick from the catalog.</p>}
        </div>

        <div className="flex justify-end gap-2">
          {editingId && <button onClick={reset} className="btn-secondary">Cancel</button>}
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : (editingId ? 'Update clearance' : 'Save clearance')}</button>
        </div>
      </div>

      {/* Saved list */}
      {list.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider bg-page/50">
              <th className="px-4 py-2.5 font-semibold">Artist</th><th className="px-4 py-2.5 font-semibold">Title</th><th className="px-4 py-2.5 font-semibold">Tracks</th><th className="px-4 py-2.5 font-semibold">Updated</th><th className="px-4 py-2.5"></th>
            </tr></thead>
            <tbody>
              {list.map(c => (
                <tr key={c.id} className="border-b border-divider last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-ink">{c.artist_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.title || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.track_count}</td>
                  <td className="px-4 py-3 text-gray-400">{new Date(c.updated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => download(c.id)} title="Download XLSX" className="text-gray-400 hover:text-emerald-600 px-1.5"><FileSpreadsheet size={15} /></button>
                    <button onClick={() => edit(c)} title="Edit" className="text-gray-400 hover:text-brand-600 px-1.5"><Pencil size={14} /></button>
                    <button onClick={() => remove(c.id)} title="Delete" className="text-gray-300 hover:text-red-600 px-1.5"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

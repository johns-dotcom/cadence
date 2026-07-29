import { useEffect, useState } from 'react'
import { Plus, FileText, Upload, Trash2, Download, Sparkles, Loader2 } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { CONTRACT_TYPES, CONTRACT_STATUSES } from '../constants'

const CLAUSE_KINDS = [
  'Recording royalty', 'Advance & recoupment', 'Term & option periods', 'Delivery commitment',
  'Territory', 'Exclusivity', 'Mechanical royalties', 'Publishing split', 'Termination', 'Confidentiality',
]

const STATUS_STYLES = {
  Active:     'bg-emerald-100 text-emerald-700',
  Pending:    'bg-amber-100 text-amber-700',
  Expired:    'bg-gray-100 text-gray-500',
  Terminated: 'bg-red-100 text-red-700',
}

export default function Contracts() {
  const { toast } = useToast()
  const [contracts, setContracts] = useState([])
  const [artists, setArtists] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ artist_id: '', type: 'Recording', status: 'Active', date_signed: '', expiration_date: '', royalty_split: '', advance: '', territory: '', num_releases: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [aiKind, setAiKind] = useState(CLAUSE_KINDS[0])
  const [aiContext, setAiContext] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  const draftClause = async () => {
    setAiBusy(true)
    try {
      const { data } = await api.post('/contracts/draft-clause', { kind: aiKind, context: aiContext })
      const clause = data.data?.text?.trim()
      if (clause) {
        setForm(f => ({ ...f, notes: f.notes ? `${f.notes}\n\n${aiKind.toUpperCase()}\n${clause}` : `${aiKind.toUpperCase()}\n${clause}` }))
        setAiContext('')
        toast('Clause drafted — review and edit in Notes')
      }
    } catch (err) {
      toast(err.response?.data?.error || 'Drafting failed', 'error')
    } finally { setAiBusy(false) }
  }

  const load = () => {
    setLoading(true)
    Promise.all([api.get('/contracts'), api.get('/artists')])
      .then(([c, a]) => { setContracts(c.data.data || []); setArtists(a.data.data || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/contracts', { ...form, artist_id: form.artist_id || undefined, date_signed: form.date_signed || undefined, expiration_date: form.expiration_date || undefined })
      toast('Contract added')
      setForm({ artist_id: '', type: 'Recording', status: 'Active', date_signed: '', expiration_date: '', royalty_split: '', advance: '', territory: '', num_releases: '', notes: '' })
      setShowForm(false); load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add contract', 'error')
    } finally { setSaving(false) }
  }

  const uploadDoc = async (contractId, file) => {
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    try {
      await api.post(`/contracts/${contractId}/file`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast('File uploaded'); load()
    } catch (err) {
      toast(err.response?.data?.error || 'Upload failed', 'error')
    }
  }

  const openDoc = async (contractId) => {
    try {
      const { data } = await api.get(`/contracts/${contractId}`)
      if (data.data?.file_url) window.open(data.data.file_url, '_blank', 'noopener')
      else toast('No file attached', 'error')
    } catch { toast('Could not open file', 'error') }
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this contract?')) return
    try { await api.delete(`/contracts/${id}`); load() } catch { toast('Failed', 'error') }
  }

  return (
    <div>
      <PageHeader
        title="Contracts"
        subtitle="Artist agreements and documents"
        action={<button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add contract</button>}
      />

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="label">Artist</label>
            <select className="input" value={form.artist_id} onChange={set('artist_id')}>
              <option value="">Unassigned</option>
              {artists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div><label className="label">Type</label><select className="input" value={form.type} onChange={set('type')}>{CONTRACT_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
          <div><label className="label">Status</label><select className="input" value={form.status} onChange={set('status')}>{CONTRACT_STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><label className="label">Date signed</label><input type="date" className="input" value={form.date_signed} onChange={set('date_signed')} /></div>
          <div><label className="label">Expiration</label><input type="date" className="input" value={form.expiration_date} onChange={set('expiration_date')} /></div>
          <div><label className="label">Royalty split</label><input className="input" value={form.royalty_split} onChange={set('royalty_split')} placeholder="e.g. 50/50" /></div>
          <div><label className="label">Advance</label><input className="input" value={form.advance} onChange={set('advance')} /></div>
          <div><label className="label">Territory</label><input className="input" value={form.territory} onChange={set('territory')} placeholder="e.g. Worldwide" /></div>
          <div><label className="label"># Releases</label><input className="input" value={form.num_releases} onChange={set('num_releases')} /></div>
          <div className="lg:col-span-3 rounded-xl border border-dashed border-rule bg-page/40 p-3">
            <div className="flex items-center gap-1.5 mb-2"><Sparkles size={14} className="text-brand-600" /><span className="text-xs font-semibold text-ink">Draft a clause with AI</span></div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-44"><label className="label">Clause</label><select className="input !py-1.5 text-sm" value={aiKind} onChange={e => setAiKind(e.target.value)}>{CLAUSE_KINDS.map(k => <option key={k}>{k}</option>)}</select></div>
              <div className="flex-1 min-w-[180px]"><label className="label">Terms / context (optional)</label><input className="input !py-1.5 text-sm" value={aiContext} onChange={e => setAiContext(e.target.value)} placeholder="e.g. 18% royalty, 2 albums, recoupable advance" /></div>
              <button type="button" onClick={draftClause} disabled={aiBusy} className="btn-secondary !py-1.5">{aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {aiBusy ? 'Drafting…' : 'Generate'}</button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Generated clauses are appended to Notes for review. AI features require a configured key.</p>
          </div>
          <div className="lg:col-span-3"><label className="label">Notes / clauses</label><textarea className="input" rows={4} value={form.notes} onChange={set('notes')} /></div>
          <div><button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : 'Add contract'}</button></div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : contracts.length === 0 ? (
        <div className="card p-10 text-center"><FileText size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No contracts yet.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Artist</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Signed</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Expires</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Document</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {contracts.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-ink">{c.artist_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.type}</td>
                  <td className="px-4 py-3 text-gray-600">{c.date_signed ? new Date(c.date_signed).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.expiration_date ? new Date(c.expiration_date).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[c.status] || STATUS_STYLES.Active}`}>{c.status}</span></td>
                  <td className="px-4 py-3">
                    {c.file_name ? (
                      <button onClick={() => openDoc(c.id)} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"><Download size={13} /> Open</button>
                    ) : (
                      <label className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 cursor-pointer">
                        <Upload size={13} /> Upload
                        <input type="file" className="hidden" onChange={e => uploadDoc(c.id, e.target.files[0])} />
                      </label>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(c.id)} className="text-gray-400 hover:text-danger" title="Delete"><Trash2 size={15} /></button>
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

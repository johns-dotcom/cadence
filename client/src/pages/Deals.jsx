import { useEffect, useState } from 'react'
import { Plus, Trash2, TrendingUp, X, ExternalLink } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { DEAL_STAGES, DEAL_TYPES, PRIORITIES } from '../constants'
import { formatDate } from '../utils/dates'
import useHotkeys from '../hooks/useHotkeys'

const PRIORITY_DOT = { High: 'bg-red-500', Medium: 'bg-amber-500', Low: 'bg-gray-400' }
const BLANK = { artist_name: '', genre: '', stage: 'Scouting', ar_rep: '', source: '', deal_type: '', offer_amount: '', priority: 'Medium', next_followup_date: '', contact: '', links: '', notes: '' }
const money = (n) => `$${Number(n || 0).toLocaleString()}`

export default function Deals() {
  const { toast } = useToast()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const [active, setActive] = useState(null) // deal open in the detail drawer

  const load = () => {
    setLoading(true)
    api.get('/deals').then(res => setDeals(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // "n" opens the new-deal form; Esc closes the drawer / form.
  useHotkeys({
    n: () => { if (!active) setShowForm(true) },
    Escape: () => { setActive(null); setShowForm(false) },
  }, [active])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e.preventDefault()
    if (!form.artist_name.trim()) return
    setSaving(true)
    try {
      await api.post('/deals', { ...form, offer_amount: form.offer_amount || undefined, next_followup_date: form.next_followup_date || undefined })
      toast('Deal added')
      setForm(BLANK); setShowForm(false); load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add deal', 'error')
    } finally { setSaving(false) }
  }

  const patchDeal = async (id, fields, { silent } = {}) => {
    try {
      const { data } = await api.patch(`/deals/${id}`, fields)
      setDeals(ds => ds.map(d => d.id === id ? data.data : d))
      setActive(a => (a && a.id === id ? data.data : a))
      if (!silent) toast('Saved')
      return true
    } catch { toast('Failed to update', 'error'); return false }
  }

  const moveToStage = (id, stage) => {
    const deal = deals.find(d => d.id === id)
    if (!deal || deal.stage === stage) return
    setDeals(ds => ds.map(d => d.id === id ? { ...d, stage } : d)) // optimistic
    patchDeal(id, { stage }, { silent: true })
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this deal?')) return
    try { await api.delete(`/deals/${id}`); setActive(null); load() } catch { toast('Failed', 'error') }
  }

  const grouped = {}
  DEAL_STAGES.forEach(s => { grouped[s] = deals.filter(d => d.stage === s) })

  return (
    <div>
      <PageHeader
        title="Deal Pipeline"
        subtitle={`${deals.length} deal${deals.length === 1 ? '' : 's'} · drag to move · press n to add`}
        action={<button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add deal</button>}
      />

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div><label className="label">Artist</label><input className="input" value={form.artist_name} onChange={set('artist_name')} autoFocus /></div>
          <div><label className="label">Genre</label><input className="input" value={form.genre} onChange={set('genre')} /></div>
          <div><label className="label">Stage</label><select className="input" value={form.stage} onChange={set('stage')}>{DEAL_STAGES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><label className="label">A&R rep</label><input className="input" value={form.ar_rep} onChange={set('ar_rep')} /></div>
          <div><label className="label">Source</label><input className="input" value={form.source} onChange={set('source')} placeholder="e.g. Referral, Inbound" /></div>
          <div><label className="label">Deal type</label><select className="input" value={form.deal_type} onChange={set('deal_type')}><option value="">—</option>{DEAL_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
          <div><label className="label">Offer amount</label><input type="number" className="input" value={form.offer_amount} onChange={set('offer_amount')} placeholder="0" /></div>
          <div><label className="label">Priority</label><select className="input" value={form.priority} onChange={set('priority')}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></div>
          <div><label className="label">Next follow-up</label><input type="date" className="input" value={form.next_followup_date} onChange={set('next_followup_date')} /></div>
          <div className="lg:col-span-3"><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={set('notes')} /></div>
          <div><button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : 'Add deal'}</button></div>
        </form>
      )}

      {loading ? (
        <Skeleton.KanbanBoard />
      ) : deals.length === 0 ? (
        <div className="card p-10 text-center"><TrendingUp size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No deals yet. Press <kbd className="px-1 rounded bg-gray-100 text-xs">n</kbd> to add one.</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {DEAL_STAGES.map(stage => (
            <div
              key={stage}
              onDragOver={e => { e.preventDefault(); setDragOver(stage) }}
              onDragLeave={() => setDragOver(o => (o === stage ? null : o))}
              onDrop={() => { if (dragId != null) moveToStage(dragId, stage); setDragId(null); setDragOver(null) }}
              className={`bg-elev border rounded-2xl p-3 transition-colors ${dragOver === stage ? 'border-brand-400 bg-brand-50/40' : 'border-rule'}`}
            >
              <div className="flex items-center justify-between px-1 mb-2">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wide">{stage}</h3>
                <span className="text-xs text-gray-400">{grouped[stage].length}</span>
              </div>
              <div className="space-y-2 min-h-[40px]">
                {grouped[stage].map(deal => (
                  <div
                    key={deal.id}
                    draggable
                    onDragStart={() => setDragId(deal.id)}
                    onDragEnd={() => { setDragId(null); setDragOver(null) }}
                    onClick={() => setActive(deal)}
                    className={`card p-3 group cursor-pointer hover:border-brand-300 transition ${dragId === deal.id ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[deal.priority] || PRIORITY_DOT.Medium}`} />
                          <p className="text-sm font-semibold text-ink truncate">{deal.artist_name}</p>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{[deal.genre, deal.ar_rep].filter(Boolean).join(' · ') || '—'}</p>
                        {deal.offer_amount && <p className="text-xs text-gray-500 mt-1">Offer: {money(deal.offer_amount)}</p>}
                        {deal.next_followup_date && <p className="text-[11px] text-amber-600 mt-0.5">Follow up {formatDate(deal.next_followup_date)}</p>}
                      </div>
                      <button onClick={e => { e.stopPropagation(); remove(deal.id) }} className="text-gray-300 hover:text-danger opacity-0 group-hover:opacity-100 transition" title="Delete"><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
                {grouped[stage].length === 0 && <p className="text-xs text-gray-300 px-1 py-2">Drop here</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {active && <DealDrawer deal={active} onClose={() => setActive(null)} onSave={patchDeal} onDelete={remove} />}
    </div>
  )
}

// Slide-in card detail: edit every field, including contacts + links, and move stage.
function DealDrawer({ deal, onClose, onSave, onDelete }) {
  const [d, setD] = useState(deal)
  useEffect(() => { setD(deal) }, [deal.id])
  const f = (k) => (e) => setD(s => ({ ...s, [k]: e.target.value }))
  const linkList = (d.links || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)

  const save = () => onSave(deal.id, {
    artist_name: d.artist_name, genre: d.genre || null, stage: d.stage, ar_rep: d.ar_rep || null,
    source: d.source || null, deal_type: d.deal_type || null, offer_amount: d.offer_amount || null,
    priority: d.priority, next_followup_date: d.next_followup_date || null, last_contact_date: d.last_contact_date || null,
    contact: d.contact || null, links: d.links || null, notes: d.notes || null,
  }).then(() => onClose())

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-overlay" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-card border-l border-rule shadow-modal overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider sticky top-0 bg-card z-10">
          <h2 className="text-base font-semibold text-ink truncate">{d.artist_name || 'Deal'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label className="label">Artist</label><input className="input" value={d.artist_name || ''} onChange={f('artist_name')} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Stage</label><select className="input" value={d.stage} onChange={f('stage')}>{DEAL_STAGES.map(s => <option key={s}>{s}</option>)}</select></div>
            <div><label className="label">Priority</label><select className="input" value={d.priority || 'Medium'} onChange={f('priority')}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></div>
            <div><label className="label">Genre</label><input className="input" value={d.genre || ''} onChange={f('genre')} /></div>
            <div><label className="label">Deal type</label><select className="input" value={d.deal_type || ''} onChange={f('deal_type')}><option value="">—</option>{DEAL_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
            <div><label className="label">A&R rep</label><input className="input" value={d.ar_rep || ''} onChange={f('ar_rep')} /></div>
            <div><label className="label">Source</label><input className="input" value={d.source || ''} onChange={f('source')} /></div>
            <div><label className="label">Offer amount</label><input type="number" className="input" value={d.offer_amount || ''} onChange={f('offer_amount')} /></div>
            <div><label className="label">Next follow-up</label><input type="date" className="input" value={d.next_followup_date ? String(d.next_followup_date).slice(0, 10) : ''} onChange={f('next_followup_date')} /></div>
          </div>
          <div><label className="label">Contact</label><input className="input" value={d.contact || ''} onChange={f('contact')} placeholder="Name, email, or phone" /></div>
          <div>
            <label className="label">Links</label>
            <textarea className="input" rows={2} value={d.links || ''} onChange={f('links')} placeholder="Spotify, socials, press… (one per line)" />
            {linkList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {linkList.map((l, i) => {
                  const href = /^https?:\/\//.test(l) ? l : `https://${l}`
                  return <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-brand-600 hover:underline max-w-[200px] truncate"><ExternalLink size={10} /> {l}</a>
                })}
              </div>
            )}
          </div>
          <div><label className="label">Notes</label><textarea className="input" rows={4} value={d.notes || ''} onChange={f('notes')} /></div>
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t border-divider sticky bottom-0 bg-card">
          <button onClick={() => onDelete(deal.id)} className="btn-secondary text-danger"><Trash2 size={15} /> Delete</button>
          <button onClick={save} className="btn-primary">Save changes</button>
        </div>
      </div>
    </div>
  )
}

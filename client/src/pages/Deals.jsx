import { useEffect, useState } from 'react'
import { Plus, ChevronRight, Trash2, TrendingUp } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { DEAL_STAGES, DEAL_TYPES, PRIORITIES } from '../constants'

const PRIORITY_DOT = { High: 'bg-red-500', Medium: 'bg-amber-500', Low: 'bg-gray-400' }

export default function Deals() {
  const { toast } = useToast()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ artist_name: '', genre: '', stage: 'Scouting', ar_rep: '', source: '', deal_type: '', offer_amount: '', priority: 'Medium', next_followup_date: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    api.get('/deals').then(res => setDeals(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e.preventDefault()
    if (!form.artist_name.trim()) return
    setSaving(true)
    try {
      await api.post('/deals', {
        ...form,
        offer_amount: form.offer_amount || undefined,
        next_followup_date: form.next_followup_date || undefined,
      })
      toast('Deal added')
      setForm({ artist_name: '', genre: '', stage: 'Scouting', ar_rep: '', source: '', deal_type: '', offer_amount: '', priority: 'Medium', next_followup_date: '', notes: '' })
      setShowForm(false); load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add deal', 'error')
    } finally { setSaving(false) }
  }

  const advance = async (deal) => {
    const i = DEAL_STAGES.indexOf(deal.stage)
    if (i < 0 || i >= DEAL_STAGES.length - 1) return
    try { await api.patch(`/deals/${deal.id}`, { stage: DEAL_STAGES[i + 1] }); load() }
    catch { toast('Failed to update stage', 'error') }
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this deal?')) return
    try { await api.delete(`/deals/${id}`); load() } catch { toast('Failed', 'error') }
  }

  const grouped = {}
  DEAL_STAGES.forEach(s => { grouped[s] = deals.filter(d => d.stage === s) })

  return (
    <div>
      <PageHeader
        title="Deal Pipeline"
        subtitle={`${deals.length} deal${deals.length === 1 ? '' : 's'} across ${DEAL_STAGES.length} stages`}
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
        <p className="text-sm text-gray-400">Loading…</p>
      ) : deals.length === 0 ? (
        <div className="card p-10 text-center"><TrendingUp size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No deals yet.</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {DEAL_STAGES.map(stage => (
            <div key={stage} className="bg-elev border border-rule rounded-2xl p-3">
              <div className="flex items-center justify-between px-1 mb-2">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wide">{stage}</h3>
                <span className="text-xs text-gray-400">{grouped[stage].length}</span>
              </div>
              <div className="space-y-2">
                {grouped[stage].map(deal => (
                  <div key={deal.id} className="card p-3 group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[deal.priority] || PRIORITY_DOT.Medium}`} />
                          <p className="text-sm font-semibold text-ink truncate">{deal.artist_name}</p>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {[deal.genre, deal.ar_rep].filter(Boolean).join(' · ') || '—'}
                        </p>
                        {deal.offer_amount && <p className="text-xs text-gray-500 mt-1">Offer: ${Number(deal.offer_amount).toLocaleString()}</p>}
                        {deal.next_followup_date && <p className="text-[11px] text-amber-600 mt-0.5">Follow up {new Date(deal.next_followup_date).toLocaleDateString()}</p>}
                      </div>
                      <button onClick={() => remove(deal.id)} className="text-gray-300 hover:text-danger opacity-0 group-hover:opacity-100 transition" title="Delete"><Trash2 size={13} /></button>
                    </div>
                    {stage !== DEAL_STAGES[DEAL_STAGES.length - 1] && stage !== 'Signed' && (
                      <button onClick={() => advance(deal)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:text-brand-700">
                        Advance <ChevronRight size={12} />
                      </button>
                    )}
                  </div>
                ))}
                {grouped[stage].length === 0 && <p className="text-xs text-gray-300 px-1 py-2">Empty</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

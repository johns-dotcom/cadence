import { useEffect, useState } from 'react'
import { Plus, X, Trash2, Megaphone } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { CURRENCIES } from '../constants'

const STATUSES = ['Planned', 'Active', 'Completed', 'Cancelled']
const STATUS_STYLE = {
  Planned: 'bg-gray-100 text-gray-600', Active: 'bg-brand-500/15 text-brand-700',
  Completed: 'bg-emerald-100 text-emerald-700', Cancelled: 'bg-red-100 text-red-700',
}
const money = (n, c = 'USD') => `${c === 'USD' ? '$' : c + ' '}${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const BLANK = { name: '', artist_id: '', platform: '', status: 'Planned', planned_budget: '', actual_spend: '', currency: 'USD', handles: '', notes: '' }

export default function Campaigns() {
  const { toast } = useToast()
  const [campaigns, setCampaigns] = useState([])
  const [artists, setArtists] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)

  const load = () => { setLoading(true); api.get('/campaigns').then(r => setCampaigns(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(() => { load(); api.get('/artists').then(r => setArtists(r.data.data || [])).catch(() => {}) }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { toast('Campaign name is required', 'error'); return }
    try {
      await api.post('/campaigns', { ...form, artist_id: form.artist_id || undefined })
      toast('Campaign added'); setShowForm(false); setForm(BLANK); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const setStatus = async (c, status) => {
    try { await api.patch(`/campaigns/${c.id}`, { status }); load() } catch { toast('Failed', 'error') }
  }
  const remove = async (id) => {
    if (!window.confirm('Delete this campaign?')) return
    try { await api.delete(`/campaigns/${id}`); load() } catch { toast('Failed', 'error') }
  }

  const totalPlanned = campaigns.reduce((s, c) => s + Number(c.planned_budget || 0), 0)
  const totalSpend = campaigns.reduce((s, c) => s + Number(c.actual_spend || 0), 0)

  return (
    <div>
      <PageHeader
        title="Marketing"
        subtitle="Campaign spend across the roster"
        action={<button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add campaign</button>}
      />

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card p-4"><p className="text-xs text-gray-400 mb-1">Planned budget</p><p className="text-xl font-bold text-ink">{money(totalPlanned)}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-400 mb-1">Actual spend</p><p className="text-xl font-bold text-brand-600">{money(totalSpend)}</p></div>
      </div>

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="col-span-2 sm:col-span-1"><label className="label">Name</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div><label className="label">Artist</label><select className="input" value={form.artist_id} onChange={e => setForm(f => ({ ...f, artist_id: e.target.value }))}><option value="">—</option>{artists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div><label className="label">Platform</label><input className="input" value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))} placeholder="TikTok, Meta…" /></div>
          <div><label className="label">Planned budget</label><input type="number" step="0.01" className="input" value={form.planned_budget} onChange={e => setForm(f => ({ ...f, planned_budget: e.target.value }))} /></div>
          <div><label className="label">Actual spend</label><input type="number" step="0.01" className="input" value={form.actual_spend} onChange={e => setForm(f => ({ ...f, actual_spend: e.target.value }))} /></div>
          <div><label className="label">Currency</label><select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="col-span-2 sm:col-span-2"><label className="label">Handles / creators</label><input className="input" value={form.handles} onChange={e => setForm(f => ({ ...f, handles: e.target.value }))} placeholder="@creator1, @creator2" /></div>
          <div className="col-span-2 sm:col-span-3"><button className="btn-primary">Save campaign</button></div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : campaigns.length === 0 ? (
        <div className="card p-10 text-center"><Megaphone size={26} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No campaigns yet.</p></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map(c => (
            <div key={c.id} className="card p-4 group">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{c.name}</p>
                  <p className="text-[11px] text-gray-400">{[c.artist_name, c.platform].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <button onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity flex-shrink-0"><Trash2 size={14} /></button>
              </div>
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="text-gray-500">Spend <span className="font-semibold text-ink">{money(c.actual_spend, c.currency)}</span></span>
                <span className="text-gray-400">/ {money(c.planned_budget, c.currency)}</span>
              </div>
              <select value={c.status} onChange={e => setStatus(c, e.target.value)}
                className={`text-[10px] font-semibold rounded-full px-2 py-1 border-0 cursor-pointer ${STATUS_STYLE[c.status] || STATUS_STYLE.Planned}`}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

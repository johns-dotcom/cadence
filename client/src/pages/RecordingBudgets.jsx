import { useEffect, useState } from 'react'
import { Plus, Trash2, Lock, Check, ChevronRight, ChevronDown, PiggyBank } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { EXPENSE_CATEGORIES } from '../constants'

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const SECTIONS = ['Producers', 'Studio', 'Mixing/Mastering', 'Musicians', 'Travel', 'Other']
const STATUS_STYLE = { draft: 'bg-gray-100 text-gray-600', approved: 'bg-emerald-100 text-emerald-700', locked: 'bg-amber-100 text-amber-700' }

export default function RecordingBudgets() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState({})
  const [showNew, setShowNew] = useState(false)
  const [nb, setNb] = useState({ title: '', artist: '', contingency_pct: '' })
  const [item, setItem] = useState({ section: 'Producers', description: '', category: '', amount: '' })

  const load = () => { setLoading(true); api.get('/recording-budgets').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])
  const loadDetail = (id) => api.get(`/recording-budgets/${id}`).then(r => setDetail(d => ({ ...d, [id]: r.data.data }))).catch(() => {})
  const toggle = (id) => { if (openId === id) { setOpenId(null); return } setOpenId(id); if (!detail[id]) loadDetail(id) }

  const create = async () => {
    if (!nb.title.trim()) { toast('Title is required', 'error'); return }
    try { await api.post('/recording-budgets', nb); toast('Budget created'); setNb({ title: '', artist: '', contingency_pct: '' }); setShowNew(false); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const setStatus = async (id, status) => { try { await api.post(`/recording-budgets/${id}/status`, { status }); loadDetail(id); load() } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') } }
  const remove = async (id) => { if (!window.confirm('Delete this budget?')) return; try { await api.delete(`/recording-budgets/${id}`); load() } catch { toast('Failed', 'error') } }
  const addItem = async (id) => {
    if (!item.amount) { toast('Amount is required', 'error'); return }
    try { await api.post(`/recording-budgets/${id}/items`, item); setItem({ section: 'Producers', description: '', category: '', amount: '' }); loadDetail(id); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const delItem = async (id, itemId) => { try { await api.delete(`/recording-budgets/items/${itemId}`); loadDetail(id); load() } catch { toast('Failed', 'error') } }

  const bySection = (items) => { const g = {}; items.forEach(i => { (g[i.section || 'Other'] = g[i.section || 'Other'] || []).push(i) }); return Object.entries(g) }

  return (
    <div>
      <PageHeader title="Recording Budgets" subtitle="Plan a budget, track actuals against it"
        action={<button onClick={() => setShowNew(v => !v)} className="btn-primary"><Plus size={16} /> New budget</button>} />

      {showNew && (
        <div className="card p-4 mb-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input className="input sm:col-span-2" placeholder="Title (e.g. Debut EP)" value={nb.title} onChange={e => setNb(f => ({ ...f, title: e.target.value }))} />
          <input className="input" placeholder="Artist" value={nb.artist} onChange={e => setNb(f => ({ ...f, artist: e.target.value }))} />
          <div className="flex gap-2">
            <input type="number" className="input" placeholder="Contingency %" value={nb.contingency_pct} onChange={e => setNb(f => ({ ...f, contingency_pct: e.target.value }))} />
            <button onClick={create} className="btn-primary flex-shrink-0">Create</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={5} cols={4} /></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center"><PiggyBank size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No budgets yet.</p></div>
      ) : (
        <div className="space-y-3">
          {rows.map(b => {
            const d = detail[b.id]; const open = openId === b.id
            const variance = b.actual - b.budgeted
            return (
              <div key={b.id} className="card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50" onClick={() => toggle(b.id)}>
                  {open ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{b.title} {b.artist && <span className="text-xs text-gray-400 font-normal">· {b.artist}</span>}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[b.status]}`}>{b.status}</span>
                  <div className="text-right text-xs">
                    <p className="text-gray-400">Budget {money(b.budgeted)}</p>
                    <p className={variance > 0 ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>Actual {money(b.actual)}</p>
                  </div>
                </div>
                {open && (
                  <div className="border-t border-divider px-4 py-3">
                    {!d ? <p className="text-xs text-gray-400">Loading…</p> : (
                      <>
                        <div className="flex items-center gap-2 mb-3">
                          {b.status !== 'locked' && <>
                            {b.status === 'draft' && <button onClick={() => setStatus(b.id, 'approved')} className="btn-secondary !py-1 text-xs"><Check size={13} /> Approve</button>}
                            {b.status === 'approved' && <button onClick={() => setStatus(b.id, 'draft')} className="btn-secondary !py-1 text-xs">Back to draft</button>}
                            {b.status === 'approved' && <button onClick={() => setStatus(b.id, 'locked')} className="btn-secondary !py-1 text-xs"><Lock size={13} /> Lock</button>}
                          </>}
                          <span className="flex-1" />
                          <button onClick={() => remove(b.id)} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button>
                        </div>

                        {bySection(d.items).map(([section, items]) => (
                          <div key={section} className="mb-2">
                            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{section} · {money(items.reduce((s, i) => s + Number(i.amount || 0), 0))}</p>
                            {items.map(i => (
                              <div key={i.id} className="flex items-center gap-2 text-xs py-1 border-b border-divider last:border-0">
                                <span className="flex-1 text-gray-600">{i.description || '—'}{i.category ? ` · ${i.category}` : ''}</span>
                                <span className="text-ink font-medium tabular-nums">{money(i.amount)}</span>
                                {b.status !== 'locked' && <button onClick={() => delItem(b.id, i.id)} className="text-gray-300 hover:text-red-600"><Trash2 size={12} /></button>}
                              </div>
                            ))}
                          </div>
                        ))}
                        {!d.items.length && <p className="text-xs text-gray-400 mb-2">No line items yet.</p>}

                        {b.status !== 'locked' && (
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3 pt-3 border-t border-divider">
                            <select className="input !py-1.5 text-sm" value={item.section} onChange={e => setItem(f => ({ ...f, section: e.target.value }))}>{SECTIONS.map(s => <option key={s}>{s}</option>)}</select>
                            <input className="input !py-1.5 text-sm" placeholder="Description" value={item.description} onChange={e => setItem(f => ({ ...f, description: e.target.value }))} />
                            <select className="input !py-1.5 text-sm" value={item.category} onChange={e => setItem(f => ({ ...f, category: e.target.value }))}><option value="">Category…</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
                            <input type="number" step="0.01" className="input !py-1.5 text-sm" placeholder="0.00" value={item.amount} onChange={e => setItem(f => ({ ...f, amount: e.target.value }))} />
                            <button onClick={() => addItem(b.id)} className="btn-primary !py-1.5 text-xs">Add line</button>
                          </div>
                        )}
                        {Number(b.contingency_pct) > 0 && <p className="text-[11px] text-gray-400 mt-2">Includes {b.contingency_pct}% contingency.</p>}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

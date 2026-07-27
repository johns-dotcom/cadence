import { useEffect, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ChevronDown, Plus, ExternalLink, Check } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { EXPENSE_CATEGORIES, CURRENCIES } from '../constants'

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function Recoupments() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState({})     // artistId -> detail payload
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [adding, setAdding] = useState(null)    // artistId being added to
  const [form, setForm] = useState({ payee: '', category: '', song: '', amount: '', currency: 'USD' })

  const load = () => { setLoading(true); api.get('/financials/recoupments').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(load, [])

  const active = rows.filter(r => r.recoupable_spend > 0 || r.income > 0)

  const loadDetail = (artistId) => {
    setLoadingDetail(true)
    api.get(`/financials/recoupments/${artistId}`).then(r => setDetail(d => ({ ...d, [artistId]: r.data.data }))).catch(() => {}).finally(() => setLoadingDetail(false))
  }
  const toggle = (artistId) => {
    if (openId === artistId) { setOpenId(null); return }
    setOpenId(artistId); setAdding(null)
    if (!detail[artistId]) loadDetail(artistId)
  }

  const toggleUfr = async (artistId, en) => {
    try { await api.post(`/financials/recoupments/${en.id}/ufr`, { ufr: !en.ufr }); loadDetail(artistId) }
    catch { toast('Failed', 'error') }
  }

  const addExpense = async (artistName, artistId) => {
    if (!form.amount) { toast('Amount is required', 'error'); return }
    try {
      await api.post('/financials/recoupments/add-expense', { ...form, artist: artistName })
      toast('Recoupable expense added')
      setForm({ payee: '', category: '', song: '', amount: '', currency: 'USD' }); setAdding(null)
      loadDetail(artistId); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const bySong = (entries) => {
    const g = {}
    entries.forEach(e => { const k = e.song || '—'; (g[k] = g[k] || []).push(e) })
    return Object.entries(g)
  }

  return (
    <div>
      <PageHeader title="Recoupments" subtitle="Recoupable spend vs. income — expand an artist for the detail"
        action={<Link to="/recoupments/planning" className="btn-secondary"><Plus size={15} /> Planning</Link>} />
      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={6} cols={5} /></div>
      ) : active.length === 0 ? (
        <div className="card p-10 text-center"><p className="text-sm text-gray-500">No recoupable activity yet. Mark ledger entries as recoupable and record artist income to see balances here.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider bg-page/50">
                <th className="px-4 py-2.5 font-semibold">Artist</th>
                <th className="px-4 py-2.5 font-semibold text-right">Recoupable spend</th>
                <th className="px-4 py-2.5 font-semibold text-right">Income</th>
                <th className="px-4 py-2.5 font-semibold text-right">Balance</th>
                <th className="px-4 py-2.5 font-semibold text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {active.map(r => {
                const d = detail[r.artist_id]
                const open = openId === r.artist_id
                return (
                  <Fragment key={r.artist_id}>
                    <tr className="border-b border-divider hover:bg-gray-50 cursor-pointer" onClick={() => toggle(r.artist_id)}>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                          {open ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
                          {r.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-red-600">{money(r.recoupable_spend)}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{money(r.income)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${r.balance >= 0 ? 'text-ink' : 'text-red-600'}`}>{money(r.balance)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.recouped ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{r.recouped ? 'Recouped' : 'Unrecouped'}</span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-page/30">
                        <td colSpan={5} className="px-4 py-3">
                          {loadingDetail && !d ? <p className="text-xs text-gray-400">Loading…</p> : d && (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <Link to={`/artists/${r.artist_id}`} className="text-xs font-semibold text-brand-600 hover:underline">Open artist profile →</Link>
                                <button onClick={() => setAdding(adding === r.artist_id ? null : r.artist_id)} className="text-xs font-semibold text-brand-600 hover:underline inline-flex items-center gap-1"><Plus size={12} /> Add recoupable expense</button>
                              </div>

                              {adding === r.artist_id && (
                                <div className="card p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
                                  <input className="input !py-1.5 text-sm" placeholder="Payee / description" value={form.payee} onChange={e => setForm(f => ({ ...f, payee: e.target.value }))} />
                                  <input className="input !py-1.5 text-sm" placeholder="Song (opt)" value={form.song} onChange={e => setForm(f => ({ ...f, song: e.target.value }))} />
                                  <select className="input !py-1.5 text-sm" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}><option value="">Category…</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
                                  <div className="flex gap-1">
                                    <input type="number" step="0.01" className="input !py-1.5 text-sm" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                                    <select className="input !py-1.5 text-sm !w-20" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
                                  </div>
                                  <button onClick={() => addExpense(r.name, r.artist_id)} className="btn-primary !py-1.5 text-xs">Add</button>
                                </div>
                              )}

                              {d.entries.length === 0 ? <p className="text-xs text-gray-400">No recoupable entries.</p> : bySong(d.entries).map(([song, items]) => (
                                <div key={song}>
                                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{song} · {money(items.reduce((s, e) => s + Number(e.amount_usd || 0), 0))}</p>
                                  <div className="space-y-1">
                                    {items.map(en => (
                                      <div key={en.id} className="flex items-center gap-2 text-xs bg-card border border-divider rounded-lg px-2.5 py-1.5">
                                        <span className="text-gray-500 w-20 flex-shrink-0">{formatDate(en.payment_date || en.invoice_date)}</span>
                                        <span className="text-ink flex-1 truncate">{en.payee || '—'}{en.category ? ` · ${en.category}` : ''}</span>
                                        <span className="text-ink font-medium tabular-nums">{money(en.amount_usd)}</span>
                                        <button onClick={() => toggleUfr(r.artist_id, en)} title="Mark recovered (statement)" className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${en.ufr ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                                          {en.ufr && <Check size={10} />} UFR{en.statement_month ? ` ${en.statement_month}` : ''}
                                        </button>
                                        <Link to={`/ledger?focus=${en.id}`} title="View in ledger" className="text-gray-400 hover:text-brand-600"><ExternalLink size={13} /></Link>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}

                              <div className="flex gap-4 text-xs text-gray-500 pt-1 border-t border-divider">
                                <span>Spend <span className="text-red-600 font-medium">{money(d.totals.recoupable_spend)}</span></span>
                                <span>Income <span className="text-emerald-600 font-medium">{money(d.totals.income)}</span></span>
                                <span>Balance <span className={`font-semibold ${d.totals.balance >= 0 ? 'text-ink' : 'text-red-600'}`}>{money(d.totals.balance)}</span></span>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

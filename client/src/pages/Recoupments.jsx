import { useEffect, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ChevronDown, Plus, ExternalLink, Check, Star, Flag, CalendarClock } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { CURRENCIES } from '../constants'
import CategoryOptions from '../components/CategoryOptions'

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function Recoupments() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState({})     // artistId -> detail payload
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [adding, setAdding] = useState(null)    // artistId being added to
  const [form, setForm] = useState({ payee: '', category: '', song: '', amount: '', currency: 'USD', paid: false })

  const [tab, setTab] = useState('artists')
  const [prioTab, setPrioTab] = useState('all')
  const [statements, setStatements] = useState([])
  const [priorYear, setPriorYear] = useState([])
  const load = () => { setLoading(true); api.get('/financials/recoupments').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])
  useEffect(() => { if (tab === 'statements') api.get('/financials/statements').then(r => setStatements(r.data.data || [])).catch(() => {}) }, [tab])
  useEffect(() => { if (tab === 'prioryear') api.get('/financials/recoupments-prior-year').then(r => setPriorYear(r.data.data || [])).catch(() => {}) }, [tab])

  const activeAll = rows.filter(r => r.recoupable_spend > 0 || r.income > 0)
  const active = prioTab === 'all' ? activeAll : activeAll.filter(r => (r.priority || '').toLowerCase() === prioTab)

  // Save a shared artist_meta field (priority / ready_for_planning / notes).
  const setMeta = async (name, patch) => {
    setRows(rs => rs.map(r => r.name === name ? { ...r, ...patch } : r))
    try { await api.post('/financials/recoupments/artist-meta', { artist: name, ...patch }) } catch { toast('Failed to save', 'error'); load() }
  }
  const tagPriorYear = async (id, tag) => {
    try { await api.post('/financials/recoupments/prior-year', { ids: [id], tag }); toast(tag ? `Tagged ${tag}` : 'Untagged'); if (openId) loadDetail(openId); load() }
    catch { toast('Failed', 'error') }
  }
  const byMonth = statements.reduce((g, e) => { (g[e.statement_month || 'Unstamped'] = g[e.statement_month || 'Unstamped'] || []).push(e); return g }, {})

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
      setForm({ payee: '', category: '', song: '', amount: '', currency: 'USD', paid: false }); setAdding(null)
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

      <div className="flex items-center gap-1 mb-4">
        {[['artists', 'By artist'], ['statements', 'Statements'], ['prioryear', 'Prior year']].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${tab === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>{lbl}</button>
        ))}
      </div>

      {/* Priority is a TAG with subtabs — never a sort key. */}
      {tab === 'artists' && (
        <div className="flex items-center gap-1 mb-4">
          {[['all', 'All'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']].map(([k, lbl]) => (
            <button key={k} onClick={() => setPrioTab(k)} className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition ${prioTab === k ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{lbl}</button>
          ))}
        </div>
      )}

      {tab === 'prioryear' ? (
        <PriorYearView rows={priorYear} onUntag={(id) => tagPriorYear(id, null)} />
      ) : tab === 'statements' ? (
        Object.keys(byMonth).length === 0 ? (
          <div className="card p-10 text-center"><p className="text-sm text-gray-500">No committed statements yet. Mark entries UFR (here or in Planning) to build a statement.</p></div>
        ) : (
          <div className="space-y-4">
            {Object.entries(byMonth).map(([month, items]) => (
              <div key={month} className="card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider bg-page/50">
                  <span className="font-semibold text-ink text-sm">Statement {month}</span>
                  <span className="text-sm font-semibold text-ink">{money(items.reduce((s, e) => s + Number(e.amount_usd || 0), 0))}</span>
                </div>
                <table className="w-full text-sm"><tbody className="divide-y divide-divider">
                  {items.map(e => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-ink">{e.artist || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{e.song || '—'}</td>
                      <td className="px-4 py-2 text-gray-500 truncate">{e.payee || '—'}</td>
                      <td className="px-4 py-2 text-right text-ink tabular-nums">{money(e.amount_usd)}</td>
                      <td className="px-4 py-2 text-right"><Link to={`/ledger?focus=${e.id}`} className="text-gray-400 hover:text-brand-600 inline-block"><ExternalLink size={13} /></Link></td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
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
                          {r.priority && <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${r.priority.toLowerCase() === 'high' ? 'bg-red-100 text-red-700' : r.priority.toLowerCase() === 'low' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700'}`}>{r.priority}</span>}
                          {r.ready_for_planning && <span title="Ready for planning" className="text-emerald-600"><Star size={12} fill="currentColor" /></span>}
                          {r.flagged && <span title={r.flag_reason || 'Flagged'} className="text-amber-500"><Flag size={12} /></span>}
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
                              <div className="flex flex-wrap items-center gap-2 justify-between">
                                <div className="flex flex-wrap items-center gap-2">
                                  <select value={r.priority || ''} onChange={e => setMeta(r.name, { priority: e.target.value || null })} className="input !py-1 !px-2 text-xs !w-auto">
                                    <option value="">Priority…</option><option>High</option><option>Medium</option><option>Low</option>
                                  </select>
                                  <button onClick={() => setMeta(r.name, { ready_for_planning: !r.ready_for_planning })} className={`text-xs font-medium inline-flex items-center gap-1 px-2 py-1 rounded-lg ${r.ready_for_planning ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}><Star size={12} /> {r.ready_for_planning ? 'Ready for planning' : 'Mark ready'}</button>
                                </div>
                                <div className="flex items-center gap-3">
                                  <Link to={`/artists/${r.artist_id}`} className="text-xs font-semibold text-brand-600 hover:underline">Artist profile →</Link>
                                  <button onClick={() => setAdding(adding === r.artist_id ? null : r.artist_id)} className="text-xs font-semibold text-brand-600 hover:underline inline-flex items-center gap-1"><Plus size={12} /> Add expense</button>
                                </div>
                              </div>
                              <input defaultValue={r.notes || ''} onBlur={e => { if (e.target.value !== (r.notes || '')) setMeta(r.name, { notes: e.target.value }) }} placeholder="Notes for this artist…" className="input !py-1.5 text-xs w-full" />

                              {adding === r.artist_id && (
                                <div className="card p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
                                  <input className="input !py-1.5 text-sm" placeholder="Payee / description" value={form.payee} onChange={e => setForm(f => ({ ...f, payee: e.target.value }))} />
                                  <input className="input !py-1.5 text-sm" placeholder="Song (opt)" value={form.song} onChange={e => setForm(f => ({ ...f, song: e.target.value }))} />
                                  <select className="input !py-1.5 text-sm" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}><option value="">Category…</option><CategoryOptions /></select>
                                  <div className="flex gap-1">
                                    <input type="number" step="0.01" className="input !py-1.5 text-sm" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                                    <select className="input !py-1.5 text-sm !w-20" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
                                  </div>
                                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={form.paid} onChange={e => setForm(f => ({ ...f, paid: e.target.checked }))} /> Already paid</label>
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
                                        <button onClick={() => { const y = window.prompt('Move to prior-year subpage — enter the year (e.g. 2024):'); if (y) tagPriorYear(en.id, y.trim()) }} title="Tag prior year" className="text-gray-400 hover:text-brand-600"><CalendarClock size={13} /></button>
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

// Prior-year subpage — tagged rows grouped into per-artist key cards + summary,
// with an unmark action per row.
function PriorYearView({ rows, onUntag }) {
  if (!rows.length) return <div className="card p-10 text-center"><p className="text-sm text-gray-500">No prior-year entries. Tag entries from an artist's detail to move them here.</p></div>
  const byArtist = {}
  rows.forEach(r => { (byArtist[r.artist || '—'] = byArtist[r.artist || '—'] || []).push(r) })
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Object.entries(byArtist).map(([artist, items]) => {
        const total = items.reduce((s, e) => s + Number(e.amount_usd || 0), 0)
        return (
          <div key={artist} className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider bg-page/50">
              <span className="font-semibold text-ink text-sm">{artist}</span>
              <span className="text-sm font-semibold text-ink">{money(total)} <span className="text-[10px] text-gray-400 font-normal">{items.length} entr{items.length === 1 ? 'y' : 'ies'}</span></span>
            </div>
            <div className="divide-y divide-divider">
              {items.map(e => (
                <div key={e.id} className="flex items-center gap-2 px-4 py-2 text-xs">
                  <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{e.prior_year_tag}</span>
                  <span className="text-ink flex-1 truncate">{e.payee || '—'}{e.song ? ` · ${e.song}` : ''}</span>
                  <span className="text-ink font-medium tabular-nums">{money(e.amount_usd)}</span>
                  <button onClick={() => onUntag(e.id)} title="Unmark" className="text-gray-400 hover:text-brand-600">Unmark</button>
                  <Link to={`/ledger?focus=${e.id}`} className="text-gray-400 hover:text-brand-600"><ExternalLink size={13} /></Link>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

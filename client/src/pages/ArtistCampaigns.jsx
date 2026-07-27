import { useEffect, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ChevronDown, ExternalLink, Download, Megaphone, Check, X } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Per-artist marketing-spend reconciliation. Campaign spend = expenses flagged
// campaign (or auto-detected from a marketing category). Expand an artist to
// see the spend by song, toggle cobrand / not-campaign, and jump to the ledger.
export default function ArtistCampaigns() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openArtist, setOpenArtist] = useState(null)
  const [detail, setDetail] = useState({})
  const [loadingDetail, setLoadingDetail] = useState(false)

  const load = () => { setLoading(true); api.get('/artist-campaigns').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(load, [])

  const loadDetail = (artist) => { setLoadingDetail(true); api.get(`/artist-campaigns/${encodeURIComponent(artist)}`).then(r => setDetail(d => ({ ...d, [artist]: r.data.data }))).catch(() => {}).finally(() => setLoadingDetail(false)) }
  const toggle = (artist) => { if (openArtist === artist) { setOpenArtist(null); return } setOpenArtist(artist); if (!detail[artist]) loadDetail(artist) }

  const flag = async (artist, en, patch) => {
    try { await api.post(`/artist-campaigns/entries/${en.id}/flags`, patch); loadDetail(artist); load() }
    catch { toast('Failed', 'error') }
  }

  const exportCsv = () => {
    const lines = ['Artist,Campaign spend USD,Cobrand USD,Entries']
    rows.forEach(r => lines.push(`"${r.artist}",${r.spend},${r.cobrand},${r.count}`))
    const url = window.URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'artist-campaigns.csv'; document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
  }

  const bySong = (entries) => { const g = {}; entries.forEach(e => { const k = e.song || '—'; (g[k] = g[k] || []).push(e) }); return Object.entries(g) }

  return (
    <div>
      <PageHeader title="Artist Campaigns" subtitle="Marketing spend per artist — reconcile, cobrand, and plan"
        action={rows.length > 0 && <button onClick={exportCsv} className="btn-secondary"><Download size={15} /> Export</button>} />

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={6} cols={4} /></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center"><Megaphone size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No campaign spend yet. Marketing-category expenses show here automatically, or flag any ledger entry as a campaign.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider bg-page/50">
                <th className="px-4 py-2.5 font-semibold">Artist</th>
                <th className="px-4 py-2.5 font-semibold text-right">Campaign spend</th>
                <th className="px-4 py-2.5 font-semibold text-right">Cobrand</th>
                <th className="px-4 py-2.5 font-semibold text-right">Entries</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const d = detail[r.artist]; const open = openArtist === r.artist
                const maxCat = d ? Math.max(1, ...d.categories.map(c => c.total)) : 1
                return (
                  <Fragment key={r.artist}>
                    <tr className="border-b border-divider hover:bg-gray-50 cursor-pointer" onClick={() => toggle(r.artist)}>
                      <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 font-medium text-ink">{open ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}{r.artist}</span></td>
                      <td className="px-4 py-3 text-right font-semibold text-ink">{money(r.spend)}</td>
                      <td className="px-4 py-3 text-right text-violet-600">{r.cobrand > 0 ? money(r.cobrand) : '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{r.count}</td>
                    </tr>
                    {open && (
                      <tr className="bg-page/30"><td colSpan={4} className="px-4 py-3">
                        {loadingDetail && !d ? <p className="text-xs text-gray-400">Loading…</p> : d && (
                          <div className="space-y-3">
                            {d.categories.length > 0 && (
                              <div className="space-y-1.5 max-w-md">
                                {d.categories.map(c => (
                                  <div key={c.category}>
                                    <div className="flex justify-between text-[11px] mb-0.5"><span className="text-gray-500">{c.category}</span><span className="font-semibold text-ink">{money(c.total)}</span></div>
                                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-brand-500 rounded-full" style={{ width: `${(c.total / maxCat) * 100}%` }} /></div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {bySong(d.entries).map(([song, items]) => (
                              <div key={song}>
                                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{song} · {money(items.reduce((s, e) => s + Number(e.amount_usd || 0), 0))}</p>
                                <div className="space-y-1">
                                  {items.map(en => (
                                    <div key={en.id} className="flex items-center gap-2 text-xs bg-card border border-divider rounded-lg px-2.5 py-1.5">
                                      <span className="text-gray-500 w-20 flex-shrink-0">{formatDate(en.payment_date || en.invoice_date)}</span>
                                      <span className="text-ink flex-1 truncate">{en.payee || '—'}{en.category ? ` · ${en.category}` : ''}</span>
                                      <span className="text-ink font-medium tabular-nums">{money(en.amount_usd)}</span>
                                      <button onClick={() => flag(r.artist, en, { cobrand: !en.cobrand })} className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase inline-flex items-center gap-0.5 ${en.cobrand ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>{en.cobrand && <Check size={10} />} Cobrand</button>
                                      <button onClick={() => flag(r.artist, en, { artist_campaign: false })} title="Remove from campaigns" className="text-gray-300 hover:text-red-600"><X size={13} /></button>
                                      <Link to={`/ledger?focus=${en.id}`} title="View in ledger" className="text-gray-400 hover:text-brand-600"><ExternalLink size={13} /></Link>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                            <div className="flex gap-4 text-xs text-gray-500 pt-1 border-t border-divider">
                              <span>Total <span className="font-semibold text-ink">{money(d.totals.spend)}</span></span>
                              <span>Cobrand <span className="font-semibold text-violet-600">{money(d.totals.cobrand)}</span></span>
                            </div>
                          </div>
                        )}
                      </td></tr>
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

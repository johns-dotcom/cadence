import { useEffect, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ChevronDown, ExternalLink, Download, Megaphone, Check, X, MessageSquare, UserCheck, Inbox } from 'lucide-react'
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
  const [team, setTeam] = useState([])
  const [inbox, setInbox] = useState([])
  const [showInbox, setShowInbox] = useState(false)

  const loadInbox = () => api.get('/artist-campaigns/review-inbox').then(r => setInbox(r.data.data || [])).catch(() => {})
  const load = () => { setLoading(true); api.get('/artist-campaigns').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(() => { load(); loadInbox(); api.get('/team').then(r => setTeam(r.data.data || [])).catch(() => {}) }, [])

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

      {inbox.length > 0 && (
        <div className="card p-3 mb-4 border-amber-200 bg-amber-50/40">
          <button onClick={() => setShowInbox(v => !v)} className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
            <Inbox size={15} /> Needs your review ({inbox.length})
            {showInbox ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {showInbox && (
            <div className="mt-2 space-y-1">
              {inbox.map(i => (
                <div key={i.id} className="flex items-center gap-2 text-xs bg-card border border-divider rounded-lg px-2.5 py-1.5">
                  <span className="font-medium text-ink">{i.artist || '—'}</span>
                  <span className="text-gray-500 flex-1 truncate">{i.payee}{i.song ? ` · ${i.song}` : ''}</span>
                  <span className="text-ink tabular-nums">{money(i.amount_usd ?? i.amount)}</span>
                  {i.comments > 0 && <span className="inline-flex items-center gap-0.5 text-gray-400"><MessageSquare size={11} /> {i.comments}</span>}
                  <Link to={`/ledger?focus=${i.id}`} className="text-gray-400 hover:text-brand-600"><ExternalLink size={13} /></Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
                                    <CampaignEntry key={en.id} en={en} team={team} onFlag={patch => flag(r.artist, en, patch)} onReviewersChanged={loadInbox} />
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

// One campaign entry row + an expandable review panel (comments + reviewers).
function CampaignEntry({ en, team, onFlag, onReviewersChanged }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState(null)
  const [reviewers, setReviewers] = useState([])
  const [body, setBody] = useState('')

  const loadPanel = () => {
    api.get(`/artist-campaigns/entries/${en.id}/comments`).then(r => setComments(r.data.data || [])).catch(() => setComments([]))
    api.get(`/artist-campaigns/entries/${en.id}/reviewers`).then(r => setReviewers((r.data.data || []).map(x => x.assignee_id))).catch(() => {})
  }
  const toggle = () => { const n = !open; setOpen(n); if (n && comments === null) loadPanel() }

  const post = async () => {
    if (!body.trim()) return
    try { await api.post(`/artist-campaigns/entries/${en.id}/comments`, { body: body.trim() }); setBody(''); loadPanel() }
    catch { toast('Failed', 'error') }
  }
  const toggleReviewer = async (uid) => {
    const next = reviewers.includes(uid) ? reviewers.filter(x => x !== uid) : [...reviewers, uid]
    setReviewers(next)
    try { await api.post(`/artist-campaigns/entries/${en.id}/reviewers`, { user_ids: next }); onReviewersChanged?.() }
    catch { toast('Failed', 'error') }
  }

  return (
    <div className="bg-card border border-divider rounded-lg">
      <div className="flex items-center gap-2 text-xs px-2.5 py-1.5">
        <span className="text-gray-500 w-20 flex-shrink-0">{formatDate(en.payment_date || en.invoice_date)}</span>
        <span className="text-ink flex-1 truncate">{en.payee || '—'}{en.category ? ` · ${en.category}` : ''}</span>
        <span className="text-ink font-medium tabular-nums">{money(en.amount_usd)}</span>
        <button onClick={() => onFlag({ cobrand: !en.cobrand })} className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase inline-flex items-center gap-0.5 ${en.cobrand ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>{en.cobrand && <Check size={10} />} Cobrand</button>
        <button onClick={toggle} title="Review" className={`${open ? 'text-brand-600' : 'text-gray-400'} hover:text-brand-600 inline-flex items-center gap-0.5`}><MessageSquare size={13} />{reviewers.length > 0 && <span className="text-[10px] font-bold">{reviewers.length}</span>}</button>
        <button onClick={() => onFlag({ artist_campaign: false })} title="Remove from campaigns" className="text-gray-300 hover:text-red-600"><X size={13} /></button>
        <Link to={`/ledger?focus=${en.id}`} title="View in ledger" className="text-gray-400 hover:text-brand-600"><ExternalLink size={13} /></Link>
      </div>
      {open && (
        <div className="border-t border-divider px-2.5 py-2 space-y-2">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 inline-flex items-center gap-1"><UserCheck size={11} /> Reviewers</p>
            <div className="flex flex-wrap gap-1">
              {team.map(u => (
                <button key={u.id} onClick={() => toggleReviewer(u.id)} className={`text-[11px] px-2 py-0.5 rounded-full ${reviewers.includes(u.id) ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{u.name}</button>
              ))}
              {!team.length && <span className="text-[11px] text-gray-300">No team members</span>}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 inline-flex items-center gap-1"><MessageSquare size={11} /> Comments</p>
            <div className="space-y-1 mb-1.5">
              {comments === null ? <p className="text-[11px] text-gray-400">Loading…</p>
                : comments.length === 0 ? <p className="text-[11px] text-gray-300">No comments yet.</p>
                : comments.map(c => <p key={c.id} className="text-[11px] text-gray-600"><span className="font-semibold text-ink">{c.author}</span> {c.body} <span className="text-gray-400">· {new Date(c.created_at).toLocaleDateString()}</span></p>)}
            </div>
            <div className="flex gap-1.5">
              <input className="input !py-1 text-xs" placeholder="Add a comment…" value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => e.key === 'Enter' && post()} />
              <button onClick={post} className="btn-secondary !py-1 text-xs flex-shrink-0">Post</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

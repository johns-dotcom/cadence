import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, AlertTriangle, Flag, FolderCheck, Check, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import CampaignChat from '../components/CampaignChat'
import { useToast } from '../context/ToastContext'

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const PRIORITY_CHIP = { High: 'bg-rose-100 text-rose-700', Medium: 'bg-amber-100 text-amber-700', Low: 'bg-sky-100 text-sky-700' }

export default function ArtistCampaigns() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [feed, setFeed] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showInbox, setShowInbox] = useState(true)
  const [showDismissed, setShowDismissed] = useState(false)

  const load = () => {
    setLoading(true)
    api.get('/artist-campaigns').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false))
    api.get('/artist-campaigns/review-feed').then(r => setFeed(r.data.data)).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const setPriority = async (a, priority) => {
    try { await api.post('/artist-campaigns/artist-meta', { artist: a.display, priority: priority || null }); load() } catch { toast('Failed', 'error') }
  }
  const setDismissed = async (a, dismissed) => {
    try { await api.post('/artist-campaigns/artist-meta', { artist: a.display, dismissed }); load() } catch { toast('Failed', 'error') }
  }
  const exportXlsx = async () => {
    try {
      const { data } = await api.get('/artist-campaigns/export', { responseType: 'blob' })
      const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = 'artist-campaigns.xlsx'; a.click(); URL.revokeObjectURL(url)
    } catch { toast('Export failed', 'error') }
  }

  const active = rows.filter(r => !r.dismissed)
  const dismissed = rows.filter(r => r.dismissed)
  const feedCount = feed ? (feed.flaggedRows.length + feed.flaggedSongs.length + feed.flaggedArtists.length) : 0

  return (
    <div>
      <PageHeader title="Artist Campaigns" subtitle="Reconcile marketing spend against campaigns, artist by artist"
        action={<button onClick={exportXlsx} className="btn-secondary"><Download size={15} /> Export Excel</button>} />

      {feedCount > 0 && (
        <div className="card mb-6 overflow-hidden">
          <button onClick={() => setShowInbox(v => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
            {showInbox ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
            <AlertTriangle size={16} className="text-amber-600" />
            <span className="font-semibold text-ink">Needs review</span>
            <span className="text-xs font-bold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">{feedCount}</span>
          </button>
          {showInbox && (
            <div className="border-t border-divider divide-y divide-divider">
              {feed.flaggedRows.map(r => (
                <button key={`r${r.id}`} onClick={() => navigate(`/artist-campaigns/${encodeURIComponent(r.artist)}`)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left">
                  <Flag size={13} className="text-rose-500 flex-shrink-0" />
                  <span className="text-sm text-ink truncate flex-1">{r.payee} · <span className="text-gray-500">{r.artist}{r.song ? ` — ${r.song}` : ''}</span></span>
                  {r.flag_reason && <span className="text-[11px] text-gray-400 truncate max-w-[240px]">{r.flag_reason}</span>}
                  {(r.assignees || []).map(u => <span key={u.id} className="text-[10px] bg-brand-100 text-brand-700 rounded-full px-1.5 py-0.5">{u.name?.split(' ')[0]}</span>)}
                </button>
              ))}
              {feed.flaggedSongs.map((s, i) => (
                <div key={`s${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm"><Flag size={13} className="text-rose-500" /><span className="text-gray-600">Flagged song · {s.song_key === '__no_song__' ? '(no song)' : s.song_key}{s.flag_reason ? ` — ${s.flag_reason}` : ''}</span></div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? <Skeleton.TaskList count={5} /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {active.map(a => (
              <div key={a.artist_key} onClick={() => navigate(`/artist-campaigns/${encodeURIComponent(a.display)}`)}
                className="card p-4 cursor-pointer hover:border-brand-300 transition-colors group relative">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className={`font-bold text-ink truncate flex items-center gap-1.5 ${a.complete ? 'line-through text-gray-400' : ''}`}>
                    {a.complete && <Check size={14} className="text-emerald-600 flex-shrink-0" />}
                    <span className="truncate">{a.display}</span>
                    {a.ready_for_planning && <FolderCheck size={14} className="text-brand-600 flex-shrink-0" />}
                  </h3>
                  <select value={a.priority || ''} onClick={e => e.stopPropagation()} onChange={e => setPriority(a, e.target.value)}
                    className={`text-[10px] font-bold uppercase rounded-full px-1.5 py-0.5 border-0 cursor-pointer flex-shrink-0 ${a.priority ? PRIORITY_CHIP[a.priority] : 'bg-gray-100 text-gray-400'}`}>
                    <option value="">—</option><option>High</option><option>Medium</option><option>Low</option>
                  </select>
                </div>
                <p className="text-xl font-bold text-ink">{usd(a.actual_total)}</p>
                <p className="text-[11px] text-gray-400">{a.spend_count} spend{a.spend_count === 1 ? '' : 's'}{a.planned_total ? ` · ${usd(a.planned_total)} planned` : ''}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {a.unpaid_count > 0 && <span className="text-[10px] font-semibold bg-rose-50 text-rose-600 rounded-full px-2 py-0.5">{a.unpaid_count} unpaid · {usd(a.unpaid_total)}</span>}
                  {a.missing_socials_count > 0 && <span className="text-[10px] font-semibold bg-amber-50 text-amber-600 rounded-full px-2 py-0.5">{a.missing_socials_count} missing socials</span>}
                  {a.flagged_songs > 0 && <span className="text-[10px] font-semibold bg-rose-100 text-rose-700 rounded-full px-2 py-0.5 inline-flex items-center gap-1"><Flag size={9} /> {a.flagged_songs}</span>}
                  {a.unlinked_campaign_count > 0 && <span className="text-[10px] font-semibold bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{a.unlinked_campaign_count} unlinked</span>}
                </div>
                <button onClick={e => { e.stopPropagation(); setDismissed(a, true) }} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 text-[11px]" title="Dismiss">✕</button>
              </div>
            ))}
          </div>
          {active.length === 0 && <div className="card p-10 text-center"><p className="text-sm text-gray-400">No campaign spend yet.</p></div>}

          {dismissed.length > 0 && (
            <div className="mt-8">
              <button onClick={() => setShowDismissed(v => !v)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 mb-3">
                {showDismissed ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Dismissed ({dismissed.length})
              </button>
              {showDismissed && (
                <div className="space-y-2">
                  {dismissed.map(a => (
                    <div key={a.artist_key} className="card p-3 flex items-center justify-between gap-3 opacity-70">
                      <span className="text-sm text-gray-600">{a.display} · {usd(a.actual_total)}</span>
                      <button onClick={() => setDismissed(a, false)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"><RotateCcw size={12} /> Restore</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <CampaignChat room="index" />
    </div>
  )
}

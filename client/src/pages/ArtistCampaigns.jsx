import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Download, AlertTriangle, Flag, FolderCheck, Check, ChevronDown, ChevronRight,
  RotateCcw, ListChecks, Users, MessageSquare, Circle, CheckCircle2,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import CampaignChat from '../components/CampaignChat'
import ArtistCampaignsQueue from './ArtistCampaignsQueue'
import UnattributedModal from '../components/campaigns/UnattributedModal'
import { Modal, Button } from '../components/ui'
import { useToast } from '../context/ToastContext'
import useFocusRefetch from '../hooks/useFocusRefetch'

// Two layers, and the page says which is which. See the header of
// server/routes/artist-campaigns.js for why one number was never enough, and for
// the double-count guard that lets these two be added together.

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const usd0 = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`
const PRIORITIES = ['High', 'Medium', 'Low']
const PRIORITY_CHIP = {
  High: 'bg-rose-500/15 text-danger', Medium: 'bg-amber-500/15 text-warning', Low: 'bg-sky-500/15 text-sky-600',
}
const todayStr = () => new Date().toISOString().slice(0, 10)

export default function ArtistCampaigns() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'queue' ? 'queue' : 'cards'

  const [range, setRange] = useState(() => ({
    from: params.get('from') || `${todayStr().slice(0, 4)}-01-01`,
    to: params.get('to') || todayStr(),
  }))
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [feed, setFeed] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showInbox, setShowInbox] = useState(true)
  const [showDismissed, setShowDismissed] = useState(false)
  const [unattributedOpen, setUnattributedOpen] = useState(false)
  const [excludedOpen, setExcludedOpen] = useState(false)
  const [assignFor, setAssignFor] = useState(null)
  const [flagFor, setFlagFor] = useState(null)

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/artist-campaigns', { params: range })
      setRows(data.data || [])
      setMeta(data.meta || null)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally { setLoading(false) }
    api.get('/artist-campaigns/review-feed').then((r) => setFeed(r.data.data)).catch(() => {})
  }, [range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  useFocusRefetch(() => load({ silent: true }))

  const setMetaFor = async (a, patch) => {
    try { await api.post('/artist-campaigns/artist-meta', { artist: a.display, ...patch }); load({ silent: true }) }
    catch { toast('Failed', 'error') }
  }
  const exportXlsx = async () => {
    try {
      const { data } = await api.get('/artist-campaigns/export', { responseType: 'blob' })
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url; a.download = `artist-campaigns-${todayStr()}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch { toast('Export failed', 'error') }
  }

  const setRange2 = (patch) => {
    const next = { ...range, ...patch }
    setRange(next)
    const p = new URLSearchParams(params)
    p.set('from', next.from); p.set('to', next.to)
    setParams(p, { replace: true })
  }
  const setView = (v) => {
    const p = new URLSearchParams(params)
    if (v === 'queue') p.set('view', 'queue'); else p.delete('view')
    setParams(p)
  }

  const active = rows.filter((r) => !r.dismissed)
  const dismissed = rows.filter((r) => r.dismissed)
  // The badge counts exactly what the tray renders.
  const feedItems = useMemo(() => {
    if (!feed) return { rows: [], songs: [], artists: [], threads: [], total: 0 }
    const out = {
      rows: feed.flaggedRows || [], songs: feed.flaggedSongs || [],
      artists: feed.flaggedArtists || [], threads: feed.openThreads || [],
    }
    out.total = out.rows.length + out.songs.length + out.artists.length + out.threads.length
    return out
  }, [feed])

  const un = meta?.unattributed
  const hasUnattributed = !!un && (un.settled > 0 || un.committed > 0)

  return (
    <div>
      <PageHeader
        title="Artist Campaigns"
        subtitle="Two layers: what the statements settled, and what is still invoiced"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setView(view === 'queue' ? 'cards' : 'queue')}
              className={`btn-secondary ${view === 'queue' ? '!bg-brand-500/15 !text-brand-ink' : ''}`}>
              <ListChecks size={15} /> {view === 'queue' ? 'Artist cards' : 'Catch-up queue'}
            </button>
            <button onClick={exportXlsx} className="btn-secondary"><Download size={15} /> Export Excel</button>
          </div>
        }
      />

      {view === 'queue' ? (
        <ArtistCampaignsQueue onClose={() => setView('cards')} />
      ) : (
        <>
          {/* ── The header band: the range binds SETTLED only ── */}
          <div className="card p-4 mb-4">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Settled</p>
                <p className="text-xl font-black text-ink tabular-nums">{usd0(meta ? meta.campaign_total - (un?.settled || 0) : 0)}</p>
                <p className="text-[10px] text-ink-faint">
                  cash basis, in range{meta?.scope?.categories ? ` · ${meta.scope.categories.join(' + ')}` : ''}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Committed</p>
                <p className="text-xl font-black text-ink tabular-nums">
                  {usd0(active.reduce((t, r) => t + r.committed, 0) + (un?.committed || 0))}
                </p>
                <p className="text-[10px] text-ink-faint">invoiced, not yet in the P&amp;L · any date</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Names an artist</p>
                <p className="text-xl font-black text-ink tabular-nums">
                  {meta?.coverage_pct == null ? '—' : `${meta.coverage_pct}%`}
                </p>
                <p className="text-[10px] text-ink-faint">of settled campaign spend</p>
              </div>
              <div className="ml-auto flex items-end gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block">
                  From
                  <input type="date" value={range.from} onChange={(e) => setRange2({ from: e.target.value })}
                    className="input !py-1 !text-[12px] block mt-0.5" />
                </label>
                <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block">
                  To
                  <input type="date" value={range.to} onChange={(e) => setRange2({ to: e.target.value })}
                    className="input !py-1 !text-[12px] block mt-0.5" />
                </label>
              </div>
            </div>
            {meta && (
              <p className="mt-2 pt-2 border-t border-divider text-[10.5px] text-ink-faint">
                Settled is the {meta.scope.basis}-basis rollup Reports uses, so it ties to the P&amp;L. Committed is
                invoice-side and deliberately unbounded by date — a November invoice still unpaid belongs in it.
                {meta.double_counted_prevented > 0 && (
                  <span> {meta.double_counted_prevented} in-scope row{meta.double_counted_prevented === 1 ? '' : 's'} the
                    P&amp;L already counted {meta.double_counted_prevented === 1 ? 'is' : 'are'} in Settled only.</span>
                )}
                {meta.scope.ties_to_pnl === false && (
                  <span className="text-danger font-semibold"> The by-artist rollup does not tie to the P&amp;L — treat Settled as suspect.</span>
                )}
              </p>
            )}
          </div>

          {/* ── What this page cannot attribute, and what it leaves out ── */}
          {(hasUnattributed || meta?.label_level?.total > 0 || meta?.excluded?.count > 0) && (
            <div className="card p-4 mb-4 border-l-4 border-l-amber-400">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">Names no artist</p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                {hasUnattributed && (
                  <button onClick={() => setUnattributedOpen(true)} className="text-left group">
                    <span className="font-bold text-ink tabular-nums group-hover:underline">{usd(un.settled)}</span>
                    <span className="text-ink-muted"> settled</span>
                    <span className="text-ink-faint text-[11px] ml-1.5">
                      {Object.entries(un.by_category || {}).filter(([, v]) => v > 0).map(([c, v]) => `${c} ${usd0(v)}`).join(' · ')}
                    </span>
                  </button>
                )}
                {un?.committed > 0 && (
                  <button onClick={() => navigate('/artist-campaigns/unassigned')} className="text-ink-muted hover:underline">
                    <span className="font-bold text-ink tabular-nums">{usd(un.committed)}</span> committed with no artist
                    <span className="text-ink-faint text-[11px]"> · open the rows</span>
                  </button>
                )}
                {meta?.label_level?.total > 0 && (
                  <button onClick={() => navigate('/ad-allocation')} className="text-ink-muted hover:underline">
                    <span className="font-bold text-ink tabular-nums">{usd(meta.label_level.total)}</span> bills the label
                    <span className="text-ink-faint text-[11px]"> · {meta.label_level.count} charges — allocate it</span>
                  </button>
                )}
                {meta?.excluded?.count > 0 && (
                  <button onClick={() => setExcludedOpen(true)} className="text-ink-muted hover:underline">
                    <span className="font-bold text-ink tabular-nums">{usd(meta.excluded.total)}</span> excluded by a person
                    <span className="text-ink-faint text-[11px]"> · {meta.excluded.count} rows</span>
                  </button>
                )}
                {hasUnattributed && (
                  <Button onClick={() => setUnattributedOpen(true)} className="ml-auto !py-1.5 text-xs">Attribute these</Button>
                )}
              </div>
            </div>
          )}

          {/* ── Needs review ── */}
          {feedItems.total > 0 && (
            <div className="card mb-6 overflow-hidden">
              <button onClick={() => setShowInbox((v) => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
                {showInbox ? <ChevronDown size={16} className="text-ink-muted" /> : <ChevronRight size={16} className="text-ink-muted" />}
                <AlertTriangle size={16} className="text-warning" />
                <span className="font-semibold text-ink">Needs review</span>
                <span className="text-xs font-bold bg-amber-500/15 text-warning rounded-full px-2 py-0.5">{feedItems.total}</span>
              </button>
              {showInbox && (
                <div className="border-t border-divider divide-y divide-divider">
                  {feedItems.rows.map((r) => (
                    <div key={`r${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-elev">
                      <Flag size={13} className="text-danger flex-shrink-0" />
                      <button onClick={() => navigate(`/artist-campaigns/${encodeURIComponent(r.artist || 'unassigned')}`)}
                        className="text-sm text-ink truncate flex-1 text-left hover:underline">
                        {r.payee} · <span className="text-ink-muted">{r.artist || 'no artist'}{r.song ? ` — ${r.song}` : ''}</span>
                      </button>
                      {r.flag_reason && <span className="text-[11px] text-ink-faint truncate max-w-[240px]">{r.flag_reason}</span>}
                      {(r.assignees || []).map((u) => (
                        <span key={u.id} className="text-[10px] bg-brand-500/15 text-brand-ink rounded-full px-1.5 py-0.5">{u.name?.split(' ')[0]}</span>
                      ))}
                      <button onClick={() => setAssignFor(r)} title="Assign a reviewer"
                        className="text-ink-muted hover:text-brand-ink flex-shrink-0"><Users size={14} /></button>
                    </div>
                  ))}
                  {feedItems.threads.map((t) => (
                    <button key={`t${t.id}`} onClick={() => navigate(`/artist-campaigns/${encodeURIComponent(t.artist || 'unassigned')}`)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-elev text-left">
                      <MessageSquare size={13} className="text-brand-ink flex-shrink-0" />
                      <span className="text-sm text-ink truncate flex-1">
                        {t.payee} · <span className="text-ink-muted">{t.last_comment_by}: {t.last_comment}</span>
                      </span>
                      <span className="text-[10px] text-ink-faint">{t.comment_count}</span>
                    </button>
                  ))}
                  {feedItems.songs.map((s, i) => (
                    <div key={`s${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <Flag size={13} className="text-danger" />
                      <span className="text-ink-muted">Flagged song · {s.song_key === '__no_song__' ? '(no song)' : s.song_key}{s.flag_reason ? ` — ${s.flag_reason}` : ''}</span>
                    </div>
                  ))}
                  {feedItems.artists.map((a, i) => (
                    <div key={`a${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <Flag size={13} className="text-danger" />
                      <span className="text-ink-muted">Flagged artist · {a.artist_key}{a.flag_reason ? ` — ${a.flag_reason}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="card p-8 text-center">
              <p className="text-sm text-danger">{error}</p>
              <button onClick={() => load()} className="mt-3 text-xs font-bold underline decoration-dotted">Try again</button>
            </div>
          )}

          {loading ? <Skeleton.TaskList count={5} /> : !error && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {active.map((a) => (
                  <ArtistCard key={a.artist_key} a={a}
                    onOpen={() => navigate(`/artist-campaigns/${encodeURIComponent(a.display)}`)}
                    onPriority={(p) => setMetaFor(a, { priority: p })}
                    onComplete={() => setMetaFor(a, { complete: !a.complete })}
                    onFlag={() => setFlagFor(a)}
                    onDismiss={() => setMetaFor(a, { dismissed: true })} />
                ))}
              </div>
              {active.length === 0 && (
                <div className="card p-10 text-center">
                  <p className="text-sm text-ink-muted">No campaign spend in this range.</p>
                  <p className="text-[11px] text-ink-faint mt-1">
                    Scope: {(meta?.scope?.categories || []).join(', ') || '—'}. Widen the dates, or reclassify a category
                    into &ldquo;Campaign &amp; promotion&rdquo; on Settings → Categories.
                  </p>
                </div>
              )}

              {dismissed.length > 0 && (
                <div className="mt-8">
                  <button onClick={() => setShowDismissed((v) => !v)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted mb-3">
                    {showDismissed ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Dismissed ({dismissed.length})
                  </button>
                  {showDismissed && (
                    <div className="space-y-2">
                      {dismissed.map((a) => (
                        <div key={a.artist_key} className="card p-3 flex items-center justify-between gap-3 opacity-70">
                          <span className="text-sm text-ink-muted">
                            {a.display} · {usd(a.settled)} settled · {usd(a.committed)} committed
                          </span>
                          <button onClick={() => setMetaFor(a, { dismissed: false })}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline">
                            <RotateCcw size={12} /> Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      <CampaignChat room="index" />

      <UnattributedModal open={unattributedOpen} onClose={() => setUnattributedOpen(false)}
        categories={meta?.scope?.categories || []} range={range} meta={meta}
        onChanged={() => load({ silent: true })} />

      <Modal open={excludedOpen} onClose={() => setExcludedOpen(false)} title="Excluded by a person">
        <p className="text-sm text-ink-muted">
          {usd(meta?.excluded?.total)} across {meta?.excluded?.count} in-scope row(s) is not in the Committed figure,
          because somebody dismissed it from this page or marked it &ldquo;not a campaign expense&rdquo;. Both are
          restorable from the artist&rsquo;s own page — open the artist and use the dismissed tray.
        </p>
        <p className="text-[11px] text-ink-faint mt-2">
          Stated because it MOVES Committed. A figure that quietly omits money reads as complete.
        </p>
      </Modal>

      {assignFor && <AssignModal entry={assignFor} onClose={() => setAssignFor(null)} onSaved={() => { setAssignFor(null); load({ silent: true }) }} toast={toast} />}
      {flagFor && <FlagModal artist={flagFor} onClose={() => setFlagFor(null)}
        onSave={(reason, on) => { setMetaFor(flagFor, { flagged: on, flag_reason: reason }); setFlagFor(null) }} />}
    </div>
  )
}

// ── One card, two layers ─────────────────────────────────────────────────────
// The right rail is the money: Settled over Committed, with the reconciliation
// problem ("paid, no bank line") attached to SETTLED — that is the layer it
// describes. Priority is three discrete buttons, never a native <select>: the
// reference app abandoned selects on cards for cross-browser and touch quirks.
function ArtistCard({ a, onOpen, onPriority, onComplete, onFlag, onDismiss }) {
  const total = a.settled + a.committed
  const settledPct = total > 0 ? Math.round((a.settled / total) * 100) : 0
  return (
    <div className="card p-4 hover:border-brand-300 transition-colors group relative">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button onClick={onComplete} title={a.complete ? 'Mark not complete' : 'Mark complete'}
              className={`flex-shrink-0 ${a.complete ? 'text-success' : 'text-ink-faint hover:text-success'}`}>
              {a.complete ? <CheckCircle2 size={15} /> : <Circle size={15} />}
            </button>
            <button onClick={onOpen} className={`font-bold text-ink truncate text-left hover:underline ${a.complete ? 'line-through text-ink-muted' : ''}`}>
              {a.display}
            </button>
            {a.ready_for_planning && <FolderCheck size={14} className="text-brand-ink flex-shrink-0" title="Ready for planning" />}
            <button onClick={onFlag} title={a.flag_reason || 'Flag this artist'}
              className={`flex-shrink-0 inline-flex items-center gap-0.5 ${a.flagged ? 'text-danger' : 'text-ink-faint hover:text-danger'}`}>
              <Flag size={13} />
              {a.flagged_songs > 0 && <span className="text-[10px] font-bold tabular-nums">{a.flagged_songs}</span>}
            </button>
          </div>
          <p className="text-[11px] text-ink-faint mt-0.5">
            {a.committed_count} spend{a.committed_count === 1 ? '' : 's'}
            {a.campaign_count > 0 ? ` · ${a.campaign_count} campaign${a.campaign_count === 1 ? '' : 's'}` : ''}
            {a.planned_total > 0 ? ` · ${usd0(a.planned_total)} planned` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {a.unpaid_count > 0 && <span className="text-[10px] font-semibold bg-rose-500/10 text-danger rounded-full px-2 py-0.5">{a.unpaid_count} unpaid · {usd0(a.committed_unpaid)}</span>}
            {a.missing_socials_count > 0 && <span className="text-[10px] font-semibold bg-amber-500/10 text-warning rounded-full px-2 py-0.5">{a.missing_socials_count} missing socials</span>}
            {a.unlinked_campaign_count > 0 && <span className="text-[10px] font-semibold bg-elev text-ink-muted rounded-full px-2 py-0.5">{a.unlinked_campaign_count} unlinked</span>}
            {a.reconciled && <span className="text-[10px] font-semibold bg-emerald-500/10 text-success rounded-full px-2 py-0.5">reconciled</span>}
          </div>
        </div>

        {/* Money rail */}
        <div className="text-right shrink-0 w-36">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Settled</p>
          <p className="text-lg font-black text-ink tabular-nums leading-tight">{usd(a.settled)}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mt-1.5">Committed</p>
          <p className="text-[15px] font-bold text-ink-muted tabular-nums leading-tight">{usd(a.committed)}</p>
          {a.committed_paid_outside_range > 0 && (
            <p className="text-[10px] text-ink-faint tabular-nums" title="Paid, but the P&L counted it in another period">
              {usd0(a.committed_paid_outside_range)} paid elsewhere
            </p>
          )}
          {a.flagged_no_bank_line?.count > 0 && (
            <p className="text-[10px] text-danger tabular-nums mt-1"
              title="Marked paid, a statement covers the date, and no bank line matches. Settled counts it; the bank does not show it.">
              {a.flagged_no_bank_line.count} paid, no bank line
            </p>
          )}
          {total > 0 && (
            <div className="h-1 rounded-full bg-elev overflow-hidden mt-1.5" title={`${settledPct}% settled`}>
              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${settledPct}%` }} />
            </div>
          )}
        </div>
      </div>

      {/* Priority — three discrete buttons, plus dismiss. */}
      <div className="flex items-center gap-1 mt-3 pt-2.5 border-t border-divider">
        {PRIORITIES.map((p) => (
          <button key={p} onClick={() => onPriority(a.priority === p ? null : p)}
            className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 border transition-colors ${
              a.priority === p ? `${PRIORITY_CHIP[p]} border-transparent` : 'text-ink-faint border-rule hover:text-ink'}`}>
            {p[0]}
          </button>
        ))}
        <span className="text-[10px] text-ink-faint ml-1">priority</span>
        <span className="ml-auto flex items-center gap-2">
          <button onClick={onOpen} className="text-[11px] font-semibold text-brand-ink hover:underline">Open</button>
          <span className="text-ink-faint">|</span>
          <button onClick={onDismiss} className="text-[11px] text-ink-faint hover:text-ink" title="Dismiss this artist from the page">Dismiss</button>
        </span>
      </div>
    </div>
  )
}

// Reviewer assignment — replace-set, matching POST /review-assign.
function AssignModal({ entry, onClose, onSaved, toast }) {
  const [users, setUsers] = useState([])
  const [sel, setSel] = useState(new Set((entry.assignees || []).map((u) => u.id)))
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get('/artist-campaigns/reviewers').then((r) => setUsers(r.data.data || [])).catch(() => setUsers([])) }, [])
  const save = async () => {
    setBusy(true)
    try { await api.post('/artist-campaigns/review-assign', { expense_id: entry.id, user_ids: [...sel] }); onSaved() }
    catch { toast('Failed', 'error'); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Reviewers · ${entry.payee}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></>}>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {users.map((u) => (
          <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-elev cursor-pointer">
            <input type="checkbox" checked={sel.has(u.id)}
              onChange={() => setSel((s) => { const n = new Set(s); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n })} />
            <span className="text-sm text-ink">{u.name}</span>
            <span className="text-[11px] text-ink-faint ml-auto">{u.role}</span>
          </label>
        ))}
        {!users.length && <p className="text-sm text-ink-muted">No teammates to assign.</p>}
      </div>
    </Modal>
  )
}

function FlagModal({ artist, onClose, onSave }) {
  const [reason, setReason] = useState(artist.flag_reason || '')
  return (
    <Modal open onClose={onClose} title={`Flag · ${artist.display}`}
      footer={
        <>
          {artist.flagged && <Button variant="secondary" onClick={() => onSave(null, false)}>Clear flag</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(reason.trim() || null, true)}>Flag</Button>
        </>
      }>
      <label className="label">Why?</label>
      <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="What needs looking at…" />
    </Modal>
  )
}

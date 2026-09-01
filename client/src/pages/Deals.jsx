import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, TrendingUp, X, ExternalLink, ChevronRight, GripVertical, Check, Paperclip, Download, Loader2 } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import ObjectDiscussion from '../components/ObjectDiscussion'
import { ConfirmDialog } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { DEAL_STAGES, DEAL_TYPES, PRIORITIES } from '../constants'
import { formatDate, isPastLocal } from '../utils/dates'
import { dropTarget } from '../utils/drop'
import useHotkeys from '../hooks/useHotkeys'

// The stage colour system. A kanban whose columns are all one colour makes the
// reader parse six identical headers to find where a card is; the dot and the
// tinted title mean the shape of the funnel is legible at a glance. Six
// distinguishable tones out of the semantic palette — no raw hex, so both
// themes and every workspace accent stay correct.
const STAGE_TONE = {
  Scouting:    { dot: 'bg-ink-faint',   text: 'text-ink-muted' },
  Meeting:     { dot: 'bg-info',        text: 'text-info' },
  Offer:       { dot: 'bg-warning',     text: 'text-warning' },
  Negotiation: { dot: 'bg-brand-500',   text: 'text-brand-ink' },
  Signed:      { dot: 'bg-success',     text: 'text-success' },
  Passed:      { dot: 'bg-ink-faint',   text: 'text-ink-faint' },
}
const FALLBACK_TONE = STAGE_TONE.Scouting

// Priority reads as a WORD, not an unlabelled 6px dot — "is this urgent" is the
// question the board exists to answer, and a grey dot next to an amber dot is
// not an answer.
const PRIORITY_PILL = {
  High:   'bg-danger/10 text-danger',
  Medium: 'bg-warning/10 text-warning',
  Low:    'bg-elev text-ink-muted',
}
const PRIORITY_SELECT = {
  High:   'border-danger/30 text-danger',
  Medium: 'border-warning/30 text-warning',
  Low:    '',
}

const BLANK = {
  artist_name: '', genre: '', stage: 'Scouting', ar_rep: '', source: '', deal_type: '',
  offer_amount: '', priority: 'Medium', next_followup_date: '', contact: '', links: '', notes: '',
}
const money = (n) => `$${Number(n || 0).toLocaleString()}`

// "Jun 12" — the card has room for a reminder, not a full date. Built off the
// string's own parts so it never TZ-shifts a day (same guard as formatDate).
function shortDate(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return formatDate(dateStr, '')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}`
}

// A stored value that predates a vocabulary change must still render. Without
// this the <select> shows blank and the next save silently deletes the field.
const withLegacy = (list, value) => (value && !list.includes(value) ? [...list, value] : list)

export default function Deals() {
  const { toast } = useToast()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const [active, setActive] = useState(null) // deal open in the detail drawer
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [fileCounts, setFileCounts] = useState({})
  // HTML5 dragenter/dragleave fire for every child element the pointer crosses,
  // so a bare "leave → clear" flickers the highlight off every time the cursor
  // passes over a card inside the column. A per-column enter/leave counter is
  // the standard fix: the column is only left when the count returns to zero.
  const dragCounters = useRef({})

  const load = () => {
    setLoading(true)
    api.get('/deals')
      .then(res => { setDeals(res.data.data || []); setError('') })
      .catch(() => setError('Failed to load the pipeline'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // "n" opens the new-deal form; Esc closes the drawer / form.
  useHotkeys({
    n: () => { if (!active) setShowForm(true) },
    Escape: () => { setActive(null); setShowForm(false) },
  }, [active])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const closeForm = () => { setForm(BLANK); setShowForm(false) }

  const create = async (e) => {
    e.preventDefault()
    if (!form.artist_name.trim()) return
    setSaving(true)
    try {
      await api.post('/deals', {
        ...form,
        // '' would post as a null offer; a deliberate 0 must survive.
        offer_amount: form.offer_amount === '' ? undefined : Number(form.offer_amount),
        next_followup_date: form.next_followup_date || undefined,
      })
      toast('Deal added')
      closeForm(); load()
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
    } catch (err) { toast(err.response?.data?.error || 'Failed to update', 'error'); return false }
  }

  const moveToStage = (id, stage) => {
    const deal = deals.find(d => d.id === id)
    if (!deal || deal.stage === stage) return
    setDeals(ds => ds.map(d => d.id === id ? { ...d, stage } : d)) // optimistic
    patchDeal(id, { stage }, { silent: true })
  }

  // One-click advance. Drag is the expressive move; this is the one people make
  // ninety per cent of the time, and it works on touch, where HTML5 drag does not.
  const advance = (deal) => {
    const next = DEAL_STAGES.indexOf(deal.stage) + 1
    if (next > 0 && next < DEAL_STAGES.length) moveToStage(deal.id, DEAL_STAGES[next])
  }

  const remove = async (id) => {
    try {
      await api.delete(`/deals/${id}`)
      setActive(null); setConfirmDelete(null); load()
    } catch { toast('Failed to delete', 'error') }
  }

  const grouped = {}
  DEAL_STAGES.forEach(s => { grouped[s] = deals.filter(d => d.stage === s) })
  const draggedDeal = dragId == null ? null : deals.find(d => d.id === dragId)

  const endDrag = () => { dragCounters.current = {}; setDragId(null); setDragOver(null) }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Deal Pipeline"
        subtitle={`${deals.length} deal${deals.length === 1 ? '' : 's'} across ${DEAL_STAGES.length} stages · drag to move · press n to add`}
        action={<button onClick={() => (showForm ? closeForm() : setShowForm(true))} className="btn-primary"><Plus size={16} /> Add deal</button>}
      />

      {showForm && (
        <form onSubmit={create} className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink">Add new deal</h2>
            <button type="button" onClick={closeForm} className="text-ink-muted hover:text-ink" aria-label="Close"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div><label className="label">Artist</label><input className="input" required value={form.artist_name} onChange={set('artist_name')} autoFocus /></div>
            <div><label className="label">Genre</label><input className="input" value={form.genre} onChange={set('genre')} /></div>
            <div><label className="label">Stage</label><select className="input" value={form.stage} onChange={set('stage')}>{DEAL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className="label">A&R rep</label><input className="input" value={form.ar_rep} onChange={set('ar_rep')} /></div>
            <div><label className="label">Source</label><input className="input" value={form.source} onChange={set('source')} placeholder="e.g. Referral, Inbound" /></div>
            <div><label className="label">Deal type</label><select className="input" value={form.deal_type} onChange={set('deal_type')}><option value="">Deal type (optional)</option>{DEAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="label">Offer amount</label><input type="number" step="0.01" min="0" className="input" value={form.offer_amount} onChange={set('offer_amount')} placeholder="0.00" /></div>
            <div><label className="label">Priority</label><select className="input" value={form.priority} onChange={set('priority')}>{PRIORITIES.map(p => <option key={p} value={p}>{`Priority: ${p}`}</option>)}</select></div>
            <div><label className="label">Next follow-up</label><input type="date" className="input" value={form.next_followup_date} onChange={set('next_followup_date')} /></div>
            <div className="lg:col-span-3"><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={set('notes')} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={closeForm} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Add deal'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <Skeleton.KanbanBoard cols={6} cards={2} />
      ) : error ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-muted mb-3">{error}</p>
          <button onClick={load} className="btn-secondary">Retry</button>
        </div>
      ) : deals.length === 0 ? (
        <div className="card p-10 text-center"><TrendingUp size={28} className="text-ink-faint mx-auto mb-3" /><p className="text-sm text-ink-muted">No deals yet. Press <kbd className="px-1 rounded bg-elev text-xs">n</kbd> to add one.</p></div>
      ) : (
        // Six stages, six columns. A funnel capped at three columns is two
        // half-funnels stacked, which is the one shape a pipeline must not have.
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {DEAL_STAGES.map(stage => {
            const tone = STAGE_TONE[stage] || FALLBACK_TONE
            const count = grouped[stage].length
            // Only a drop that would MOVE the card is a drop target. Highlighting
            // the column a card already lives in promises a change that won't happen.
            const isTarget = dragOver === stage && draggedDeal && draggedDeal.stage !== stage
            return (
              <div
                key={stage}
                onDragEnter={e => {
                  e.preventDefault()
                  dragCounters.current[stage] = (dragCounters.current[stage] || 0) + 1
                  setDragOver(stage)
                }}
                onDragLeave={() => {
                  dragCounters.current[stage] = (dragCounters.current[stage] || 0) - 1
                  if (dragCounters.current[stage] <= 0) {
                    dragCounters.current[stage] = 0
                    setDragOver(o => (o === stage ? null : o))
                  }
                }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                onDrop={e => { e.preventDefault(); if (dragId != null) moveToStage(dragId, stage); endDrag() }}
                className={`rounded-xl border p-3 min-h-[16rem] transition-colors duration-150 ${
                  isTarget ? 'border-brand-400 bg-brand-500/10 ring-1 ring-brand-300' : 'border-rule bg-card'
                }`}
              >
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-divider">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${tone.dot}`} />
                  <h3 className={`text-xs font-bold uppercase tracking-wider flex-1 truncate ${tone.text}`}>{stage}</h3>
                  {count > 0 && <span className="text-xs font-bold text-ink-muted bg-elev rounded px-1.5 py-0.5 tabular-nums">{count}</span>}
                </div>

                <div className="space-y-2">
                  {grouped[stage].map(deal => {
                    const overdue = isPastLocal(deal.next_followup_date)
                    return (
                      <div
                        key={deal.id}
                        draggable
                        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragId(deal.id) }}
                        onDragEnd={endDrag}
                        className={`card p-2.5 group cursor-grab hover:border-brand-300 hover:shadow-elevated transition ${dragId === deal.id ? 'opacity-40' : ''}`}
                      >
                        <div className="flex items-start gap-1.5">
                          <GripVertical size={12} className="text-ink-faint mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                          <button onClick={() => setActive(deal)} className="flex-1 min-w-0 text-left">
                            <p className="text-[13px] font-semibold text-ink truncate leading-tight">{deal.artist_name}</p>
                            {deal.genre && <p className="text-xs text-ink-muted mt-0.5 truncate">{deal.genre}</p>}
                            {deal.ar_rep && <p className="text-xs text-ink-muted truncate">{deal.ar_rep}</p>}
                            {deal.offer_amount != null && deal.offer_amount !== '' && (
                              <p className="text-xs text-ink-muted mt-0.5 tabular-nums">{money(deal.offer_amount)}</p>
                            )}
                            {(deal.priority || deal.next_followup_date) && (
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {deal.priority && (
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${PRIORITY_PILL[deal.priority] || PRIORITY_PILL.Medium}`}>
                                    {deal.priority}
                                  </span>
                                )}
                                {deal.next_followup_date && (
                                  // Amber ONLY when the date has passed. Colouring
                                  // every follow-up amber makes "overdue" mean nothing.
                                  <span className={`text-[11px] font-medium ${overdue ? 'text-warning' : 'text-ink-muted'}`}>
                                    Follow up: {shortDate(deal.next_followup_date)}
                                  </span>
                                )}
                              </div>
                            )}
                            {fileCounts[deal.id] > 0 && (
                              <span className="inline-flex items-center gap-0.5 mt-1 text-[10px] font-medium text-ink-faint">
                                <Paperclip size={9} /> {fileCounts[deal.id]}
                              </span>
                            )}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(deal)}
                            className="p-0.5 text-ink-faint hover:text-danger opacity-0 group-hover:opacity-100 transition flex-shrink-0"
                            title="Delete deal"
                          ><X size={12} /></button>
                        </div>
                        {deal.stage !== DEAL_STAGES[DEAL_STAGES.length - 1] && (
                          <button
                            onClick={() => advance(deal)}
                            className="mt-1.5 w-full flex items-center justify-center gap-0.5 text-[11px] font-medium text-ink-muted hover:text-brand-ink py-0.5 rounded hover:bg-brand-500/10 transition"
                          >
                            Next <ChevronRight size={11} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Only while a drag is actually over this column — a permanent
                    "Drop here" on every empty column is decoration, not a hint. */}
                {isTarget && count === 0 && (
                  <div className="border-2 border-dashed border-rule rounded-lg p-3 text-center text-[11px] font-medium text-ink-muted">
                    Drop here
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {active && (
        <DealDrawer
          deal={active}
          onClose={() => setActive(null)}
          onSave={patchDeal}
          onStage={moveToStage}
          onDelete={() => setConfirmDelete(active)}
          onFileCount={(n) => setFileCounts(c => ({ ...c, [active.id]: n }))}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => remove(confirmDelete.id)}
        title="Delete deal"
        message={confirmDelete ? `Delete the ${confirmDelete.artist_name} deal? Its notes, discussion and attached documents go with it.` : ''}
      />
    </div>
  )
}

// Slide-in card detail: edit every field, move stage, attach documents.
function DealDrawer({ deal, onClose, onSave, onStage, onDelete, onFileCount }) {
  const [d, setD] = useState(deal)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('') // '' | 'saved' | 'error'
  useEffect(() => { setD(deal); setStatus('') }, [deal.id])
  const f = (k) => (e) => setD(s => ({ ...s, [k]: e.target.value }))
  const linkList = (d.links || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
  const dateVal = (v) => (v ? String(v).slice(0, 10) : '')

  const save = async () => {
    setBusy(true)
    const ok = await onSave(deal.id, {
      artist_name: d.artist_name, genre: d.genre || null, stage: d.stage, ar_rep: d.ar_rep || null,
      source: d.source || null, deal_type: d.deal_type || null,
      // '' clears; 0 is a real offer and must not become null.
      offer_amount: d.offer_amount === '' || d.offer_amount == null ? null : Number(d.offer_amount),
      spotify_monthly_listeners: d.spotify_monthly_listeners === '' || d.spotify_monthly_listeners == null ? null : Number(d.spotify_monthly_listeners),
      priority: d.priority, next_followup_date: dateVal(d.next_followup_date) || null,
      last_contact_date: dateVal(d.last_contact_date) || null,
      contact: d.contact || null, links: d.links || null, notes: d.notes || null,
    }, { silent: true })
    setBusy(false)
    // A failed save must NOT close the drawer — closing throws away the edits
    // the user just lost the save for, which is the worst possible outcome.
    setStatus(ok ? 'saved' : 'error')
    if (ok) setTimeout(() => setStatus(s => (s === 'saved' ? '' : s)), 2000)
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-overlay" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-card border-l border-rule shadow-modal overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-divider sticky top-0 bg-card z-10">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink truncate">{d.artist_name || 'Deal'}</h2>
            <p className="text-xs text-ink-muted mt-0.5 truncate">
              {[d.stage, d.genre, d.ar_rep].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink flex-shrink-0" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Details</p>
            {status === 'saved' && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success"><Check size={11} /> Saved</span>}
            {status === 'error' && <span className="text-[11px] font-medium text-danger">Save failed — your edits are still here</span>}
          </div>

          <div><label className="label">Artist</label><input className="input" value={d.artist_name || ''} onChange={f('artist_name')} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Priority</label>
              <select className={`input font-semibold ${PRIORITY_SELECT[d.priority] || ''}`} value={d.priority || 'Medium'} onChange={f('priority')}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Deal type</label>
              <select className="input" value={d.deal_type || ''} onChange={f('deal_type')}>
                <option value="">—</option>
                {withLegacy(DEAL_TYPES, d.deal_type).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className="label">Genre</label><input className="input" value={d.genre || ''} onChange={f('genre')} /></div>
            <div><label className="label">A&R rep</label><input className="input" value={d.ar_rep || ''} onChange={f('ar_rep')} /></div>
            <div><label className="label">Source</label><input className="input" value={d.source || ''} onChange={f('source')} /></div>
            <div>
              <label className="label">Offer amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted pointer-events-none">$</span>
                <input type="number" step="0.01" min="0" placeholder="0.00" className="input pl-7" value={d.offer_amount ?? ''} onChange={f('offer_amount')} />
              </div>
            </div>
            <div><label className="label">Last contact</label><input type="date" className="input" value={dateVal(d.last_contact_date)} onChange={f('last_contact_date')} /></div>
            <div><label className="label">Next follow-up</label><input type="date" className="input" value={dateVal(d.next_followup_date)} onChange={f('next_followup_date')} /></div>
            <div className="col-span-2">
              <label className="label">Spotify monthly listeners</label>
              {/* Displayed with separators, stored as a clean integer string —
                  250000 and 250,000 are the same number, and only one of them
                  can be typed comfortably. */}
              <input
                inputMode="numeric"
                placeholder="e.g. 250,000"
                className="input tabular-nums"
                value={d.spotify_monthly_listeners === '' || d.spotify_monthly_listeners == null
                  ? '' : Number(d.spotify_monthly_listeners).toLocaleString('en-US')}
                onChange={e => {
                  const raw = e.target.value.replace(/,/g, '')
                  if (raw === '' || /^\d+$/.test(raw)) setD(s => ({ ...s, spotify_monthly_listeners: raw }))
                }}
              />
            </div>
          </div>

          <div><label className="label">Contact</label><input className="input" value={d.contact || ''} onChange={f('contact')} placeholder="Name, email, or phone" /></div>
          <div>
            <label className="label">Links</label>
            <textarea className="input" rows={2} value={d.links || ''} onChange={f('links')} placeholder="Spotify, socials, press… (one per line)" />
            {linkList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {linkList.map((l, i) => {
                  const href = /^https?:\/\//.test(l) ? l : `https://${l}`
                  return <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-brand-ink hover:underline max-w-[200px] truncate"><ExternalLink size={10} /> {l}</a>
                })}
              </div>
            )}
          </div>
          <div><label className="label">Notes</label><textarea className="input" rows={4} value={d.notes || ''} onChange={f('notes')} /></div>

          <div className="flex items-center justify-between gap-3">
            {deal.added_date ? <p className="text-xs text-ink-muted">Added {formatDate(deal.added_date)}</p> : <span />}
            <button onClick={save} disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Save changes'}</button>
          </div>

          {/* Move stage without hunting for the select — the pills are the state
              AND the control, so where the deal sits is readable at a glance. */}
          <div className="pt-4 border-t border-divider">
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-2">Move stage</p>
            <div className="flex flex-wrap gap-1.5">
              {DEAL_STAGES.map(s => (
                <button
                  key={s}
                  onClick={() => { if (s !== d.stage) { setD(x => ({ ...x, stage: s })); onStage(deal.id, s) } }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                    s === d.stage ? 'bg-brand-600 text-white' : 'bg-elev text-ink-muted hover:text-ink hover:bg-brand-500/10'
                  }`}
                >{s}</button>
              ))}
            </div>
          </div>

          <DealFiles dealId={deal.id} onCount={onFileCount} />

          <ObjectDiscussion entityType="deal" entityId={deal.id} title={`Deal · ${d.artist_name || 'Untitled'}`} />
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-divider sticky bottom-0 bg-card">
          <button onClick={onDelete} className="btn-secondary text-danger"><Trash2 size={15} /> Delete</button>
          <button onClick={save} disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  )
}

// Term sheets, demos, one-pagers. A deal's paperwork belongs on the deal — the
// alternative is somebody's inbox, which nobody else can search.
function DealFiles({ dealId, onCount }) {
  const { toast } = useToast()
  const inputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)

  const load = () => api.get(`/deals/${dealId}/files`)
    .then(r => { const list = r.data.data || []; setFiles(list); onCount?.(list.length) })
    .catch(() => {})
  useEffect(() => { load() }, [dealId]) // eslint-disable-line react-hooks/exhaustive-deps

  const doUpload = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await api.post(`/deals/${dealId}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      load()
    } catch (err) { toast(err.response?.data?.error || 'Upload failed', 'error') }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = '' }
  }

  const open = async (id) => {
    try { const { data } = await api.get(`/deals/${dealId}/files/${id}`); window.open(data.data.url, '_blank', 'noopener') }
    catch { toast('File unavailable', 'error') }
  }

  const del = async (id) => {
    try { await api.delete(`/deals/${dealId}/files/${id}`); load() }
    catch { toast('Failed to delete', 'error') }
  }

  const kb = (n) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

  return (
    <div className="pt-4 border-t border-divider" {...dropTarget(doUpload)}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Documents{files.length ? ` (${files.length})` : ''}</p>
        <button onClick={() => inputRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1 text-xs text-brand-ink hover:underline">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Attach
        </button>
        <input ref={inputRef} type="file" className="hidden" onChange={e => doUpload(e.target.files?.[0])} />
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-ink-faint">No documents. Drag one here, or use Attach.</p>
      ) : (
        <ul className="space-y-1">
          {files.map(f => (
            <li key={f.id} className="flex items-center gap-2 text-xs">
              <button onClick={() => open(f.id)} className="inline-flex items-center gap-1 text-brand-ink hover:underline min-w-0 flex-1">
                <Download size={11} className="flex-shrink-0" /> <span className="truncate">{f.original_name}</span>
              </button>
              <span className="text-ink-faint flex-shrink-0 tabular-nums">{kb(f.file_size)}</span>
              <button onClick={() => del(f.id)} className="text-ink-faint hover:text-danger flex-shrink-0" title="Remove"><Trash2 size={12} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

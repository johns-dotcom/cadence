import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Loader, Plus, Trash2, Lock, Unlock, CheckCircle2, Save, X,
  AlertTriangle, ChevronDown, ChevronRight, RefreshCw,
  Mic2, Sliders, Users, Plane, MoreHorizontal, Building2,
} from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useToast } from '../context/ToastContext'
import { moneyOrig } from '../utils/money'
import { formatDate } from '../utils/dates'

// ── Recording budget detail ────────────────────────────────────────
// The document itself: a header grid that IS the edit form, a Fund summary
// panel for fund-type budgets, and two tabs — Planning (the six template
// sections, quantity-driven) and Costs to Date (ledger actuals grouped by
// category, with a per-expense override).
//
// `readOnly` is one derived boolean (status === 'locked') and it disables
// EVERY input, not just the obvious ones — a field that still accepts a
// keystroke on a locked budget is a promise the server will break with a 403.

// Section labels + per-section column headers match the Excel templates
// exactly; the server's SECTION_SET is the validation source of truth.
const SECTIONS = [
  { key: 'producers', label: 'Producers', qtyLabel: '# Tracks', priceLabel: 'Price Per Unit', icon: Mic2, tint: 'text-rose-600' },
  { key: 'studio', label: 'Studio', qtyLabel: 'Days', priceLabel: 'Rate Per Day', icon: Building2, tint: 'text-amber-600' },
  { key: 'mixing_mastering', label: 'Mixing/Mastering', qtyLabel: '# Tracks', priceLabel: 'Day Rate', icon: Sliders, tint: 'text-emerald-600' },
  { key: 'musicians', label: 'Musicians', qtyLabel: 'Quantity', priceLabel: 'Estimated Cost', icon: Users, tint: 'text-sky-600' },
  { key: 'travel', label: 'Travel', qtyLabel: 'Quantity', priceLabel: 'Rate', icon: Plane, tint: 'text-violet-600' },
  { key: 'other', label: 'Other', qtyLabel: 'Quantity', priceLabel: 'Estimated Cost', icon: MoreHorizontal, tint: 'text-ink-muted' },
]
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD']

const TRANSITION_COPY = {
  approve: { title: 'Approve this budget?', message: 'Anyone can still edit line items until it is locked.', label: 'Approve', variant: 'primary' },
  lock: { title: 'Lock this budget?', message: 'No more edits will be possible until it is unlocked — including deleting it.', label: 'Lock', variant: 'primary' },
  reopen: { title: 'Reopen this budget to a draft?', message: 'The approval and lock stamps are cleared, so the audit trail stops claiming an approval that has been withdrawn.', label: 'Reopen', variant: 'primary' },
}

export default function RecordingBudgetDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [budget, setBudget] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('plan')
  const [artists, setArtists] = useState([])
  const [releases, setReleases] = useState([])
  const [confirm, setConfirm] = useState(null)

  const refetch = () => {
    setLoading(true)
    api.get(`/recording-budgets/${id}`)
      .then(r => { setBudget(r.data?.data || null); setError(null) })
      .catch(err => setError(err.response?.data?.error || err.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { refetch() }, [id])
  useEffect(() => {
    api.get('/artists').then(r => setArtists(r.data?.data || [])).catch(() => {})
    api.get('/releases').then(r => setReleases(r.data?.data || [])).catch(() => {})
  }, [])

  const readOnly = budget?.status === 'locked'

  const updateHeader = async (patch) => {
    if (readOnly) return
    setBudget(b => ({ ...b, ...patch }))
    try {
      const r = await api.put(`/recording-budgets/${id}`, patch)
      if (r.data?.data) setBudget(b => ({ ...b, ...r.data.data }))
    } catch (err) {
      toast(err.response?.data?.error || 'Save failed', 'error')
      refetch()
    }
  }

  const doTransition = async (verb) => {
    setConfirm(null)
    try {
      const r = await api.post(`/recording-budgets/${id}/${verb}`)
      if (r.data?.data) setBudget(b => ({ ...b, ...r.data.data }))
      toast({ approve: 'Budget approved', lock: 'Budget locked', reopen: 'Budget reopened' }[verb])
    } catch (err) { toast(err.response?.data?.error || `${verb} failed`, 'error') }
  }

  const doDelete = async () => {
    setConfirm(null)
    try { await api.delete(`/recording-budgets/${id}`); navigate('/recording-budgets') }
    catch (err) { toast(err.response?.data?.error || 'Delete failed', 'error') }
  }

  if (loading && !budget) {
    return <div><BackLink /><div className="card p-4"><Skeleton.Block /></div></div>
  }
  if (error || !budget) {
    return (
      <div>
        <BackLink />
        <div className="card p-10 text-center">
          <p className="text-sm text-danger mb-3">{error || 'Budget not found'}</p>
          <button onClick={refetch} className="btn-secondary mx-auto"><RefreshCw size={14} /> Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <BackLink />

      {/* Masthead + lifecycle */}
      <div className="card p-5">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Recording {budget.type === 'fund' ? 'Fund' : 'Budget'}</p>
            <h1 className="text-2xl font-bold text-ink tracking-tight truncate">
              {budget.artist_display || <span className="text-ink-faint italic font-normal">Unnamed artist</span>}
              {budget.project_title && <span className="text-ink-muted font-semibold"> · {budget.project_title}</span>}
            </h1>
            <p className="text-[11px] text-ink-faint mt-1">
              {budget.status === 'locked' && budget.locked_at && <>Locked by {budget.locked_by || '—'} on {formatDate(budget.locked_at)}</>}
              {budget.status === 'approved' && budget.approved_at && <>Approved by {budget.approved_by || '—'} on {formatDate(budget.approved_at)}</>}
              {budget.status === 'draft' && <>Draft{budget.created_by ? ` · started by ${budget.created_by}` : ''}</>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {budget.status === 'draft' && (
              <>
                <button onClick={() => setConfirm({ kind: 'approve' })} className="btn-primary"><CheckCircle2 size={15} /> Approve</button>
                <button onClick={() => setConfirm({ kind: 'delete' })} className="btn-secondary text-danger"><Trash2 size={14} /> Delete</button>
              </>
            )}
            {budget.status === 'approved' && (
              <>
                <button onClick={() => setConfirm({ kind: 'lock' })} className="btn-primary"><Lock size={15} /> Lock</button>
                <button onClick={() => setConfirm({ kind: 'reopen' })} className="btn-secondary">Reopen as draft</button>
              </>
            )}
            {budget.status === 'locked' && (
              <button onClick={() => setConfirm({ kind: 'reopen' })} className="btn-secondary"><Unlock size={15} /> Unlock</button>
            )}
          </div>
        </div>

        {readOnly && (
          <div className="mb-4 rounded-lg border border-rule bg-elev px-3 py-2 text-xs text-ink-muted inline-flex items-center gap-2">
            <Lock size={13} /> This budget is locked. Unlock it to edit anything, including deleting it.
          </div>
        )}

        {/* Header grid — every field saves on blur (or Enter for money) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <HeaderField label="Artist">
            <ArtistPicker budget={budget} artists={artists} readOnly={readOnly} onCommit={updateHeader} />
          </HeaderField>
          <HeaderField label="Project title">
            <input defaultValue={budget.project_title || ''} disabled={readOnly} key={`pt-${budget.id}`}
              onBlur={e => e.target.value !== (budget.project_title || '') && updateHeader({ project_title: e.target.value })}
              placeholder="e.g. LP1, Deluxe Edition…" className="input !py-1.5 text-sm" />
          </HeaderField>
          <HeaderField label="Release">
            <select value={budget.release_id || ''} disabled={readOnly} className="input !py-1.5 text-sm"
              onChange={e => updateHeader({ release_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— none —</option>
              {releases.map(r => <option key={r.id} value={r.id}>{r.project_name || `#${r.id}`}</option>)}
            </select>
          </HeaderField>
          <HeaderField label="Currency">
            <select value={budget.currency || 'USD'} disabled={readOnly} className="input !py-1.5 text-sm"
              onChange={e => updateHeader({ currency: e.target.value })}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </HeaderField>

          <HeaderField label="Type">
            <div className="flex items-center gap-1 bg-elev border border-rule rounded p-0.5">
              {['budget', 'fund'].map(t => (
                <button key={t} type="button" disabled={readOnly} onClick={() => updateHeader({ type: t })}
                  className={`flex-1 px-2 py-1 rounded text-xs font-semibold capitalize ${budget.type === t ? 'bg-card text-ink shadow-sm' : 'text-ink-muted'}`}>{t}</button>
              ))}
            </div>
          </HeaderField>
          <HeaderField label="Advance amount">
            <MoneyInput value={budget.advance_amount} readOnly={readOnly} onCommit={v => updateHeader({ advance_amount: v })} />
          </HeaderField>
          {budget.type === 'fund' && (
            <HeaderField label="Total recording fund">
              <MoneyInput value={budget.fund_amount} readOnly={readOnly} onCommit={v => updateHeader({ fund_amount: v })} />
            </HeaderField>
          )}
          <HeaderField label="Proposed # tracks">
            <input type="number" min="0" defaultValue={budget.proposed_tracks ?? ''} disabled={readOnly} key={`tr-${budget.id}`}
              onBlur={e => updateHeader({ proposed_tracks: e.target.value === '' ? null : Number(e.target.value) })}
              className="input !py-1.5 text-sm" />
          </HeaderField>
          <HeaderField label="Contingency %">
            <input type="number" step="0.5" min="0" max="100" defaultValue={budget.contingency_pct ?? ''} disabled={readOnly} key={`ct-${budget.id}`}
              onBlur={e => updateHeader({ contingency_pct: e.target.value === '' ? 0 : Number(e.target.value) })}
              className="input !py-1.5 text-sm" />
          </HeaderField>
        </div>

        {budget.type === 'fund' && (
          <div className="mt-4 pt-4 border-t border-rule grid grid-cols-2 md:grid-cols-4 gap-3">
            <FundStat label="Recording Fund Available" amount={(Number(budget.fund_amount) || 0) - (Number(budget.advance_amount) || 0)} currency={budget.currency} />
            <FundStat label="Total LP Budget" amount={Number(budget.total_budget) || 0} currency={budget.currency} />
            <FundStat label="Balance Due to Artist on Delivery" negativeTone currency={budget.currency}
              amount={(Number(budget.fund_amount) || 0) - (Number(budget.advance_amount) || 0) - (Number(budget.total_budget) || 0)} />
            <FundStat label="Contingency" muted amount={Number(budget.contingency_amount) || 0} currency={budget.currency} />
          </div>
        )}

        <div className="mt-4">
          <label className="label">Notes</label>
          <textarea defaultValue={budget.notes || ''} disabled={readOnly} rows={2} key={`nt-${budget.id}`}
            onBlur={e => e.target.value !== (budget.notes || '') && updateHeader({ notes: e.target.value })}
            className="input text-sm" placeholder="Anything the numbers don't say." />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-elev border border-rule rounded-xl p-1 w-fit">
        {[['plan', 'Planning'], ['costs', 'Costs to Date']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${tab === k ? 'bg-card text-ink shadow-sm' : 'text-ink-muted'}`}>{l}</button>
        ))}
      </div>

      {tab === 'plan'
        ? <PlanningTab budget={budget} refetch={refetch} readOnly={readOnly} />
        : <CostsToDateTab budget={budget} />}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => (confirm?.kind === 'delete' ? doDelete() : doTransition(confirm.kind))}
        title={confirm?.kind === 'delete' ? 'Delete this budget?' : TRANSITION_COPY[confirm?.kind]?.title}
        message={confirm?.kind === 'delete'
          ? 'Every line item goes with it. This cannot be undone.'
          : TRANSITION_COPY[confirm?.kind]?.message}
        confirmLabel={confirm?.kind === 'delete' ? 'Delete' : TRANSITION_COPY[confirm?.kind]?.label}
        variant={confirm?.kind === 'delete' ? 'danger' : 'primary'}
      />
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/recording-budgets" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-ink mb-4">
      <ArrowLeft size={13} /> All budgets
    </Link>
  )
}

function HeaderField({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}

function FundStat({ label, amount, currency, negativeTone, muted }) {
  const n = Number(amount) || 0
  const tone = negativeTone && n < 0 ? 'text-danger' : muted ? 'text-ink-muted' : 'text-ink'
  return (
    <div>
      <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">{label}</p>
      <p className={`text-base font-bold tabular-nums mt-0.5 ${tone}`}>{moneyOrig(n, currency)}</p>
    </div>
  )
}

// Money field that commits on Enter or blur only — an onChange commit would
// PUT once per keystroke and race itself into a half-typed number.
function MoneyInput({ value, onCommit, readOnly }) {
  const [text, setText] = useState(String(value ?? ''))
  useEffect(() => { setText(String(value ?? '')) }, [value])
  const commit = () => {
    const n = Number(String(text).replace(/[$,\s]/g, ''))
    onCommit(Number.isFinite(n) ? n : 0)
  }
  return (
    <input value={text} disabled={readOnly} className="input !py-1.5 text-sm tabular-nums"
      onChange={e => setText(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
  )
}

// Artist combobox. Filters the roster as you type but never forces a roster
// row: commit a roster match and it stores `artist_id` (clearing the freeform
// name); commit anything else and it stores `artist_name` (clearing the id).
// Both columns exist so a budget can name an artist who is not on the roster
// yet without inventing a roster row for them.
function ArtistPicker({ budget, artists, readOnly, onCommit }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState(budget.artist_display || '')
  const [hi, setHi] = useState(0)
  const boxRef = useRef(null)
  useEffect(() => { setQ(budget.artist_display || '') }, [budget.artist_display])

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (artists || []).filter(a => !s || (a.name || '').toLowerCase().includes(s)).slice(0, 8)
  }, [artists, q])

  const pickRoster = (a) => { setOpen(false); setQ(a.name); onCommit({ artist_id: a.id, artist_name: null }) }
  const pickFreeform = () => {
    setOpen(false)
    const v = q.trim()
    if (v === (budget.artist_display || '')) return
    onCommit({ artist_id: null, artist_name: v || null })
  }

  return (
    <div ref={boxRef} className="relative">
      <input value={q} disabled={readOnly} className="input !py-1.5 text-sm"
        placeholder="Type a name…"
        onChange={e => { setQ(e.target.value); setOpen(true); setHi(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setTimeout(() => { setOpen(false); pickFreeform() }, 150) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, matches.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (open && matches[hi]) pickRoster(matches[hi]); else { setOpen(false); pickFreeform() } }
          else if (e.key === 'Escape') { setOpen(false); setQ(budget.artist_display || '') }
        }} />
      {open && !readOnly && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-rule bg-card shadow-elevated max-h-56 overflow-y-auto">
          {matches.map((a, i) => (
            <button key={a.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => pickRoster(a)}
              className={`w-full text-left px-3 py-1.5 text-sm ${i === hi ? 'bg-selected text-ink' : 'text-ink-muted hover:bg-elev'}`}>
              {a.name}
            </button>
          ))}
          {!matches.length && <p className="px-3 py-2 text-xs text-ink-faint">No roster match — press Enter to use “{q.trim() || '…'}” as a freeform name.</p>}
          {!!matches.length && q.trim() && !matches.some(a => a.name === q.trim()) && (
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { setOpen(false); pickFreeform() }}
              className="w-full text-left px-3 py-1.5 text-xs text-brand-ink border-t border-divider hover:bg-elev">
              Use “{q.trim()}” as a freeform name
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Planning tab ───────────────────────────────────────────────────
function PlanningTab({ budget, refetch, readOnly }) {
  const [expandAll, setExpandAll] = useState(false)
  const subtotal = Number(budget.sections_subtotal) || 0
  const pct = Number(budget.contingency_pct) || 0
  const contingency = Number(budget.contingency_amount) || 0
  const total = Number(budget.total_budget) || 0

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10">
        <div className="card px-4 py-3 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-center">
            <div>
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Sections subtotal</p>
              <p className="text-base font-bold text-ink tabular-nums mt-0.5">{moneyOrig(subtotal, budget.currency)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Contingency ({pct.toFixed(1)}%)</p>
              <p className="text-base font-bold text-ink-muted tabular-nums mt-0.5">{moneyOrig(contingency, budget.currency)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-brand-ink uppercase tracking-wider">Total budget</p>
              <p className="text-xl font-bold text-brand-ink tabular-nums mt-0.5">{moneyOrig(total, budget.currency)}</p>
            </div>
            <div className="text-right">
              <button type="button" onClick={() => setExpandAll(v => !v)}
                className="text-[11px] font-semibold text-ink-muted hover:text-ink inline-flex items-center gap-1">
                {expandAll ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {expandAll ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {SECTIONS.map(s => (
          <SectionCard key={s.key} budget={budget} section={s} items={budget.sections?.[s.key] || []}
            readOnly={readOnly} onChanged={refetch} grandSubtotal={subtotal} forceExpanded={expandAll} />
        ))}
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-muted font-semibold">Miscellaneous / Contingency {pct.toFixed(1)}%</span>
          <span className="tabular-nums text-ink font-bold">{moneyOrig(contingency, budget.currency)}</span>
        </div>
        <div className="mt-3 pt-3 border-t-2 border-brand-500 flex items-center justify-between">
          <span className="text-base font-bold text-ink uppercase tracking-wider">Total budget</span>
          <span className="text-2xl font-bold text-brand-ink tabular-nums">{moneyOrig(total, budget.currency)}</span>
        </div>
        {budget.type === 'budget' && (
          <div className="mt-2 pt-2 border-t border-divider flex items-center justify-between text-xs text-ink-muted">
            <span>Total project costs (budget + advances)</span>
            <span className="tabular-nums font-semibold text-ink">{moneyOrig(total + (Number(budget.advance_amount) || 0), budget.currency)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

const BLANK_DRAFT = { description: '', qty: '', unit_price: '', category: '' }

function SectionCard({ budget, section, items, readOnly, onChanged, grandSubtotal, forceExpanded }) {
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)
  // The add-row draft is per SECTION CARD, so what you type into Studio can
  // never leak into Producers.
  const [draft, setDraft] = useState(BLANK_DRAFT)
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState(null)
  const [editDraft, setEditDraft] = useState(BLANK_DRAFT)
  const [confirmDel, setConfirmDel] = useState(null)
  const [userOpen, setUserOpen] = useState(false)

  const hasItems = items.length > 0
  const open = hasItems || adding || forceExpanded || userOpen
  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const share = grandSubtotal > 0 ? (total / grandSubtotal) * 100 : 0
  const Icon = section.icon

  const add = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.post(`/recording-budgets/${budget.id}/line-items`, { section: section.key, ...draft })
      setDraft(BLANK_DRAFT); setAdding(false); onChanged()
    } catch (err) { toast(err.response?.data?.error || 'Could not add the line', 'error') }
    finally { setBusy(false) }
  }
  const saveEdit = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.put(`/recording-budgets/${budget.id}/line-items/${editId}`, editDraft)
      setEditId(null); onChanged()
    } catch (err) { toast(err.response?.data?.error || 'Could not save the line', 'error') }
    finally { setBusy(false) }
  }
  const remove = async () => {
    const it = confirmDel
    setConfirmDel(null)
    try { await api.delete(`/recording-budgets/${budget.id}/line-items/${it.id}`); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Could not delete the line', 'error') }
  }

  const draftTotal = (d) => (Number(d.qty) || 0) * (Number(d.unit_price) || 0)

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <button type="button" onClick={() => setUserOpen(v => !v)} className="text-ink-faint hover:text-ink" aria-label={open ? 'Collapse section' : 'Expand section'}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <Icon size={16} className={section.tint} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">{section.label}</p>
          <p className="text-[10px] text-ink-faint">
            {hasItems ? `${items.length} line${items.length === 1 ? '' : 's'} · ${share.toFixed(0)}% of subtotal` : 'nothing here yet'}
          </p>
        </div>
        {hasItems && (
          <div className="w-24 h-1 rounded-full bg-elev overflow-hidden hidden sm:block" aria-hidden="true">
            <div className="h-full bg-brand-500" style={{ width: `${Math.min(100, share)}%` }} />
          </div>
        )}
        <p className="text-sm font-bold text-ink tabular-nums">{moneyOrig(total, budget.currency)}</p>
        {!readOnly && (
          <button type="button" onClick={() => { setAdding(true); setUserOpen(true) }} className="btn-secondary !py-1 text-xs flex-shrink-0">
            <Plus size={13} /> Add row
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-divider">
          {!hasItems && !adding ? (
            <p className="px-4 py-4 text-xs text-ink-faint">
              Nothing here yet.{!readOnly && <> <button type="button" onClick={() => setAdding(true)} className="text-brand-ink font-semibold hover:underline">Add the first item</button>.</>}
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-divider text-[10px] uppercase tracking-wider text-ink-muted">
                  <th className="text-left py-2 pl-4 pr-2 font-semibold">Description</th>
                  <th className="text-right py-2 px-2 font-semibold">{section.qtyLabel}</th>
                  <th className="text-right py-2 px-2 font-semibold">{section.priceLabel}</th>
                  <th className="text-right py-2 px-2 font-semibold">Total</th>
                  <th className="py-2 pl-2 pr-4 w-16" />
                </tr>
              </thead>
              <tbody>
                {items.map(it => editId === it.id ? (
                  <tr key={it.id} className="border-b border-divider bg-amber-500/10">
                    <td className="pl-4 pr-2 py-1.5">
                      <input autoFocus className="input !py-1 text-xs" value={editDraft.description}
                        onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" step="any" className="input !py-1 text-xs text-right" value={editDraft.qty}
                        onChange={e => setEditDraft(d => ({ ...d, qty: e.target.value }))} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" step="any" className="input !py-1 text-xs text-right" value={editDraft.unit_price}
                        onChange={e => setEditDraft(d => ({ ...d, unit_price: e.target.value }))} />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-bold text-ink">{moneyOrig(draftTotal(editDraft), budget.currency)}</td>
                    <td className="pl-2 pr-4 py-1.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button type="button" onClick={saveEdit} disabled={busy} className="text-success hover:opacity-70" aria-label="Save line"><Save size={14} /></button>
                        <button type="button" onClick={() => setEditId(null)} className="text-ink-faint hover:text-ink" aria-label="Cancel edit"><X size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={it.id} className="border-b border-divider last:border-0 hover:bg-elev">
                    <td className="pl-4 pr-2 py-2 text-ink">
                      {readOnly ? (it.description || '—') : (
                        <button type="button" className="text-left hover:underline"
                          onClick={() => { setEditId(it.id); setEditDraft({ description: it.description || '', qty: it.qty ?? '', unit_price: it.unit_price ?? '', category: it.category || '' }) }}>
                          {it.description || <span className="text-ink-faint italic">no description</span>}
                        </button>
                      )}
                      {it.category && <span className="text-ink-faint"> · {it.category}</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-muted">{Number(it.qty) || 0}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-muted">{moneyOrig(it.unit_price, budget.currency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-ink">{moneyOrig(it.amount, budget.currency)}</td>
                    <td className="pl-2 pr-4 py-2 text-right">
                      {!readOnly && <button type="button" onClick={() => setConfirmDel(it)} className="text-ink-faint hover:text-danger" aria-label="Delete line"><Trash2 size={13} /></button>}
                    </td>
                  </tr>
                ))}
                {adding && !readOnly && (
                  <tr className="border-b border-divider bg-selected">
                    <td className="pl-4 pr-2 py-1.5">
                      <input autoFocus className="input !py-1 text-xs" placeholder="Description" value={draft.description}
                        onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" step="any" className="input !py-1 text-xs text-right" placeholder={section.qtyLabel} value={draft.qty}
                        onChange={e => setDraft(d => ({ ...d, qty: e.target.value }))} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" step="any" className="input !py-1 text-xs text-right" placeholder={section.priceLabel} value={draft.unit_price}
                        onChange={e => setDraft(d => ({ ...d, unit_price: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-bold text-ink">{moneyOrig(draftTotal(draft), budget.currency)}</td>
                    <td className="pl-2 pr-4 py-1.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button type="button" onClick={add} disabled={busy} className="text-success hover:opacity-70" aria-label="Save new line"><Save size={14} /></button>
                        <button type="button" onClick={() => { setAdding(false); setDraft(BLANK_DRAFT) }} className="text-ink-faint hover:text-ink" aria-label="Cancel new line"><X size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={remove}
        title="Delete this line?"
        message={`“${confirmDel?.description || 'no description'}” — ${moneyOrig(confirmDel?.amount, budget.currency)}.`}
      />
    </div>
  )
}

// ── Costs to Date tab ──────────────────────────────────────────────
function CostsToDateTab({ budget }) {
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refetch = () => {
    setLoading(true)
    api.get(`/recording-budgets/${budget.id}/actuals`)
      .then(r => { setData(r.data?.data || null); setError(null) })
      .catch(err => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { refetch() }, [budget.id])

  const setOverride = async (expenseId, category) => {
    try {
      await api.put(`/recording-budgets/expense/${expenseId}/section`, { category: category === '__default__' ? null : category })
      refetch()
    } catch (err) { toast(err.response?.data?.error || 'Could not set the category', 'error') }
  }

  if (loading && !data) return <div className="card p-4"><Skeleton.Table rows={5} cols={4} /></div>
  if (error) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-danger mb-3">{error}</p>
        <button onClick={refetch} className="btn-secondary mx-auto"><RefreshCw size={14} /> Retry</button>
      </div>
    )
  }
  if (!data?.match_name) {
    return (
      <div className="card p-8 text-center">
        <AlertTriangle size={20} className="mx-auto text-warning mb-2" />
        <p className="text-sm text-ink-muted">No artist set — costs to date can't be calculated. Set an artist in the header above.</p>
      </div>
    )
  }

  const categoryRows = Object.entries(data.by_category || {})
    .map(([category, v]) => ({ category, ...v }))
    .filter(r => (r.planned || 0) !== 0 || (r.spent || 0) !== 0)
    .sort((a, b) => (b.planned + b.spent) - (a.planned + a.spent))

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="text-sm font-bold text-ink mb-3">Costs to date · {data.match_name}</h3>
        {budget.type === 'fund' ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <FundStat label="Recording fund" amount={data.summary.fund} currency={budget.currency} />
            <FundStat label="less Execution advance" amount={data.summary.advance} currency={budget.currency} muted />
            <FundStat label="Remainder for recording" amount={data.summary.remainder_after_advance} currency={budget.currency} />
            <FundStat label="less Recording costs to date" amount={data.summary.spent} currency={budget.currency} muted />
            <FundStat label="Balance of fund" amount={data.summary.balance_of_fund} currency={budget.currency} negativeTone />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <FundStat label="Planned" amount={data.summary.budget_planned} currency={budget.currency} />
            <FundStat label="Spent" amount={data.summary.spent} currency={budget.currency} />
            <FundStat label="Remaining" amount={data.summary.remaining} currency={budget.currency} negativeTone />
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-divider bg-elev">
          <h3 className="text-sm font-bold text-ink">By category</h3>
          <p className="text-[10px] text-ink-faint">USD-equivalent at each row's locked rate. Categories match the ledger; every expense keeps its own by default, or override any row below.</p>
        </div>
        {categoryRows.length === 0 ? (
          <p className="text-center text-xs text-ink-faint py-6">No planned lines and no spend yet — add line items on the Planning tab, or ledger expenses under this artist will appear here.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-divider text-[10px] uppercase tracking-wider text-ink-muted">
                <th className="text-left py-2 pl-4 pr-2 font-semibold">Category</th>
                <th className="text-right py-2 px-2 font-semibold">Planned</th>
                <th className="text-right py-2 px-2 font-semibold">Spent</th>
                <th className="text-right py-2 px-2 font-semibold">Remaining</th>
                <th className="text-right py-2 pl-2 pr-4 font-semibold">%</th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.map(r => {
                const pct = r.planned > 0 ? (r.spent / r.planned) * 100 : 0
                const over = r.remaining < 0
                return (
                  <tr key={r.category} className="border-b border-divider last:border-0">
                    <td className="pl-4 pr-2 py-2 font-semibold text-ink">{r.category}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-muted">{moneyOrig(r.planned, budget.currency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-success">{moneyOrig(r.spent, budget.currency)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums font-bold ${over ? 'text-danger' : 'text-ink'}`}>{moneyOrig(r.remaining, budget.currency)}</td>
                    <td className={`pl-2 pr-4 py-2 text-right tabular-nums ${over ? 'text-danger font-bold' : 'text-ink-muted'}`}>{r.planned > 0 ? `${pct.toFixed(0)}%` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-divider bg-elev">
          <h3 className="text-sm font-bold text-ink">Ledger expenses ({data.all.length})</h3>
          <p className="text-[10px] text-ink-faint">Approved rows filed under {data.match_name}{budget.release_id ? ', scoped to this release' : ''}. Overriding a row's budget category here never touches its category on the ledger.</p>
        </div>
        {!data.all.length ? (
          <p className="text-center text-xs text-ink-faint py-6">No ledger spend under this artist yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-divider text-[10px] uppercase tracking-wider text-ink-muted">
                  <th className="text-left py-2 pl-4 pr-2 font-semibold">Date</th>
                  <th className="text-left py-2 px-2 font-semibold">Vendor</th>
                  <th className="text-left py-2 px-2 font-semibold">Category</th>
                  <th className="text-right py-2 px-2 font-semibold">USD</th>
                  <th className="text-left py-2 px-2 font-semibold">Status</th>
                  <th className="text-left py-2 pl-2 pr-4 font-semibold">Budget category</th>
                </tr>
              </thead>
              <tbody>
                {data.all.map(e => (
                  <tr key={e.id} className="border-b border-divider last:border-0">
                    <td className="pl-4 pr-2 py-2 text-ink-muted whitespace-nowrap">{formatDate(e.payment_date || e.invoice_date)}</td>
                    <td className="px-2 py-2 text-ink">
                      <Link to={`/ledger?focus=${e.id}`} className="hover:underline">{e.payee || '—'}</Link>
                    </td>
                    <td className="px-2 py-2 text-ink-muted">{e.default_category}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-ink">{moneyOrig(e.amount_usd, 'USD')}</td>
                    <td className="px-2 py-2">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${e.payment_status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {e.payment_status || 'Unpaid'}
                      </span>
                    </td>
                    <td className="pl-2 pr-4 py-2">
                      <select
                        value={e.budget_category_override || '__default__'}
                        onChange={ev => setOverride(e.id, ev.target.value)}
                        className={`input !py-1 text-xs !w-auto ${e.budget_category_override ? '!border-amber-500' : ''}`}
                      >
                        <option value="__default__">use default ({e.default_category})</option>
                        {(data.category_labels || []).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

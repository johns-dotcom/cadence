import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle, Archive, AtSign, CheckCircle2, ChevronDown, ChevronRight, Circle,
  ExternalLink, Loader2, Plus, RotateCcw, Trash2, Users,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import PayeeLink from '../components/PayeeLink'
import SocialHandlesEditor from '../components/SocialHandlesEditor'
import { Modal, ConfirmDialog } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { DELIVERABLE_PLATFORMS } from '../constants'
import useFocusRefetch from '../hooks/useFocusRefetch'

// Bulk deals — one payment buying N deliverables (influencer videos, posts).
//
// The page answers four questions and nothing else: what did we buy, what
// arrived, is the money running ahead of the delivery, and which deals have gone
// silent. EVERY derived number (contracted, delivered, paid, stalled, paid-ahead,
// per-unit) is computed on the server in lib/bulkDeals and shipped down — the
// same module the notification bell reads, so the badge on a card and the alert
// in the bell can never disagree. This file formats; it does not decide.
//
// A bulk deal IS an approved `expenses` row flagged `is_bulk_deal`. Editing
// quantity/unit/socials goes through the normal ledger PATCH, and splitting
// goes through the normal ledger split endpoints, so nothing here is a second
// way to move money.

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$', MXN: 'MX$', JPY: '¥', BRL: 'R$', CHF: 'Fr ' }

function fmt(v, currency = 'USD') {
  if (v == null || v === '') return '—'
  const num = Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const code = (currency || 'USD').toUpperCase()
  const sym = CURRENCY_SYMBOLS[code]
  return sym ? sym + num : `${code} ${num}`
}

const singularUnit = (u) => {
  const s = String(u || 'item').trim() || 'item'
  return s.endsWith('s') ? s.slice(0, -1) : s
}

// The JSONB social_handles column, normalized for display. Same shape the
// Approvals deck and Artist Campaigns read.
function socialsList(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map(s => {
    const platform = (s?.platform || '').trim()
    const handle = (s?.handle || '').trim()
    if (!handle) return null
    return {
      platform, handle, artist: (s?.artist || '').trim(), amount: s?.amount,
      display: (platform ? `${platform} ${handle}` : handle) + (s?.amount ? ` · $${s.amount}` : ''),
    }
  }).filter(Boolean)
}

const GHOST_CAP = 25

export default function BulkDeals() {
  const { toast } = useToast()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [items, setItems] = useState({})        // { expenseId: [...] }
  const [loadingItems, setLoadingItems] = useState(null)
  const [newTitle, setNewTitle] = useState({})
  const [showArchived, setShowArchived] = useState(false)
  const [socialsFor, setSocialsFor] = useState(null)
  const [confirmItem, setConfirmItem] = useState(null)
  // Enter key-repeat fired N POSTs of the same title before the first resolved,
  // so one held key created six identical deliverables.
  const addBusyRef = useRef(new Set())

  const load = useCallback((quiet) => {
    if (!quiet) setLoading(true)
    return api.get('/ledger/bulk-deals')
      .then(r => { setDeals(r.data.data || []); setError('') })
      .catch(err => setError(err.response?.data?.error || 'Failed to load bulk deals'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useFocusRefetch(() => load(true))

  const patchDeal = async (dealId, fields) => {
    try {
      await api.patch(`/ledger/entries/${dealId}`, fields)
      setDeals(prev => prev.map(d => d.id === dealId ? { ...d, ...fields } : d))
      return true
    } catch (err) { toast(err.response?.data?.error || 'Failed to save', 'error'); return false }
  }

  // Archiving writes `bulk_deal_archived` (BOOLEAN). It does NOT touch
  // `bulk_deal_completed`, which is an INT count of delivered items owned by
  // Artist Campaigns — writing a boolean there would read a count of 3 as
  // "archived" and hide a half-delivered deal.
  const setArchived = async (dealId, archived) => {
    const ok = await patchDeal(dealId, { bulk_deal_archived: archived })
    if (ok) toast(archived ? 'Deal moved to completed' : 'Deal restored')
  }

  const toggleExpand = async (dealId) => {
    if (expandedId === dealId) { setExpandedId(null); return }
    setExpandedId(dealId)
    if (!items[dealId]) {
      setLoadingItems(dealId)
      try {
        const r = await api.get(`/ledger/entries/${dealId}/bulk-items`)
        setItems(prev => ({ ...prev, [dealId]: r.data.data || [] }))
      } catch (err) { toast('Failed to load deliverables', 'error') }
      finally { setLoadingItems(null) }
    }
  }

  const addItemWithTitle = async (dealId, title) => {
    if (!title || addBusyRef.current.has(dealId)) return
    addBusyRef.current.add(dealId)
    try {
      const r = await api.post(`/ledger/entries/${dealId}/bulk-items`, { title })
      setItems(prev => ({ ...prev, [dealId]: [...(prev[dealId] || []), r.data.data] }))
      setDeals(prev => prev.map(d => d.id === dealId ? recount(d, { total: +1 }) : d))
    } catch { toast('Failed to add deliverable', 'error') }
    finally { addBusyRef.current.delete(dealId) }
  }

  const addItem = async (dealId) => {
    const title = (newTitle[dealId] || '').trim()
    if (!title) return
    await addItemWithTitle(dealId, title)
    setNewTitle(prev => ({ ...prev, [dealId]: '' }))
  }

  const updateItem = async (dealId, itemId, patch) => {
    try {
      const r = await api.patch(`/ledger/bulk-items/${itemId}`, patch)
      setItems(prev => ({ ...prev, [dealId]: (prev[dealId] || []).map(i => i.id === itemId ? r.data.data : i) }))
      if ('completed' in patch) {
        setDeals(prev => prev.map(d => d.id === dealId ? recount(d, { done: patch.completed ? +1 : -1 }) : d))
      }
    } catch { toast('Failed to save', 'error') }
  }

  const deleteItem = async (dealId, item) => {
    try {
      await api.delete(`/ledger/bulk-items/${item.id}`)
      setItems(prev => ({ ...prev, [dealId]: (prev[dealId] || []).filter(i => i.id !== item.id) }))
      setDeals(prev => prev.map(d => d.id === dealId ? recount(d, { total: -1, done: item.completed ? -1 : 0 }) : d))
      setConfirmItem(null)
    } catch { toast('Failed to delete', 'error') }
  }

  const active = deals.filter(d => !d.bulk_deal_archived)
  const archived = deals.filter(d => d.bulk_deal_archived)
  // Stalled deals float to the top — they are the reason to open this page.
  // Stable sort keeps the endpoint's date order inside each group.
  const activeSorted = [...active].sort((a, b) => (b.stalled ? 1 : 0) - (a.stalled ? 1 : 0))

  const totalContracted = active.reduce((s, d) => s + (d.contracted || 0), 0)
  const totalDelivered = active.reduce((s, d) => s + (d.delivered || 0), 0)
  // Per currency, always. A single "$" over a GBP + USD total is a number
  // nobody can reconcile against a bank statement.
  const byCur = {}
  for (const d of active) {
    const c = (d.currency || 'USD').toUpperCase()
    if (!byCur[c]) byCur[c] = { amt: 0, units: 0 }
    byCur[c].amt += Number(d.deal_total) || 0
    byCur[c].units += d.contracted || 0
  }
  const committedStr = Object.entries(byCur).map(([c, v]) => fmt(v.amt, c)).join(' + ') || '—'
  const avgStr = Object.entries(byCur).filter(([, v]) => v.units > 0)
    .map(([c, v]) => `${fmt(v.amt / v.units, c)}`).join(' + ') || '—'
  const atRisk = active.filter(d => d.stalled || d.paid_ahead).length

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton.PageHeader />
        <Skeleton.StatCards count={4} />
        <div className="space-y-3"><Skeleton.Card /><Skeleton.Card /><Skeleton.Card /></div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bulk Deals"
        subtitle={`${active.length} active deal${active.length === 1 ? '' : 's'} · ${totalDelivered}/${totalContracted} contracted deliverables received${archived.length ? ` · ${archived.length} completed` : ''}`}
      />

      {error && (
        <div className="card p-4 flex items-center gap-2 text-sm text-danger">
          <AlertCircle size={16} className="flex-shrink-0" /> {error}
          <button onClick={() => load()} className="btn-secondary ml-auto">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Active deals" value={active.length} />
        <Stat label="Deliverables received" value={`${totalDelivered}/${totalContracted || '—'}`} />
        <Stat label="Committed" value={committedStr} />
        <Stat label="Avg per deliverable" value={avgStr} />
      </div>

      {atRisk > 0 && (
        <div className="card p-3 flex items-center gap-2 text-sm border-warning/30 bg-warning/10">
          <AlertCircle size={15} className="text-warning flex-shrink-0" />
          <span className="text-ink">
            {atRisk} deal{atRisk === 1 ? '' : 's'} need attention — money has run ahead of delivery, or nothing has arrived in 30+ days.
          </span>
        </div>
      )}

      {error ? null : active.length === 0 && archived.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm text-ink-muted">
            No bulk deals yet. Mark an invoice as a bulk deal on Approvals or the Ledger, and it appears here with its delivery checklist.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeSorted.map(deal => (
            <DealCard
              key={deal.id}
              deal={deal}
              expanded={expandedId === deal.id}
              items={items[deal.id] || []}
              loadingItems={loadingItems === deal.id}
              newTitle={newTitle[deal.id] || ''}
              onToggle={() => toggleExpand(deal.id)}
              onSetNewTitle={(v) => setNewTitle(p => ({ ...p, [deal.id]: v }))}
              onAddItem={() => addItem(deal.id)}
              onLogGhost={(title) => addItemWithTitle(deal.id, title)}
              onUpdateItem={(itemId, patch) => updateItem(deal.id, itemId, patch)}
              onDeleteItem={(item) => setConfirmItem({ dealId: deal.id, item })}
              onPatchDeal={(fields) => patchDeal(deal.id, fields)}
              onArchive={() => setArchived(deal.id, true)}
              onEditSocials={() => setSocialsFor(deal)}
            />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <button onClick={() => setShowArchived(v => !v)} className="flex items-center gap-2 py-2 text-sm font-bold text-ink-muted hover:text-ink">
            {showArchived ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            Completed ({archived.length})
          </button>
          {showArchived && (
            <div className="space-y-2 mt-1">
              {archived.map(d => (
                <div key={d.id} className="card px-4 py-3 flex items-center gap-3 opacity-80">
                  <CheckCircle2 size={18} className="text-success flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <PayeeLink payee={d.payee} className="text-[13px] font-bold text-ink" />
                      {d.artist && <span className="text-xs text-ink-muted">{d.artist}</span>}
                      {d.category && <Chip>{d.category}</Chip>}
                    </div>
                    {d.description && <div className="text-[11px] text-ink-faint mt-0.5 truncate max-w-[400px]">{d.description}</div>}
                  </div>
                  {/* Effective rate — what each deliverable that ACTUALLY arrived
                      cost. On a deal closed under-delivered this is the only
                      honest per-unit number; the contracted rate is fiction. */}
                  {d.effective_unit_cost != null && (
                    <span className="text-[11px] font-bold text-ink-muted flex-shrink-0 tabular-nums" title="Deal total ÷ deliverables actually received">
                      {fmt(d.effective_unit_cost, d.currency)}/{singularUnit(d.bulk_deal_unit)} effective
                    </span>
                  )}
                  <span className="text-[13px] font-bold text-ink flex-shrink-0 tabular-nums">{fmt(d.deal_total, d.currency)}</span>
                  <span className="text-[11px] text-ink-faint flex-shrink-0">{formatDate(d.invoice_date, '—')}</span>
                  <button onClick={() => setArchived(d.id, false)} className="btn-secondary text-xs flex-shrink-0" title="Move back to active">
                    <RotateCcw size={11} /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {socialsFor && (
        <SocialsModal
          deal={socialsFor}
          onClose={() => setSocialsFor(null)}
          onSaved={(rows) => {
            setDeals(prev => prev.map(d => d.id === socialsFor.id ? { ...d, social_handles: rows } : d))
            setSocialsFor(null)
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmItem}
        onClose={() => setConfirmItem(null)}
        onConfirm={() => deleteItem(confirmItem.dealId, confirmItem.item)}
        title="Remove deliverable"
        message={confirmItem ? `Remove "${confirmItem.item.title}" from this deal's checklist? The evidence link goes with it.` : ''}
        confirmLabel="Remove"
      />
    </div>
  )
}

// Local counter maintenance so a toggle doesn't cost a full refetch. Only the
// two raw counts move; every derived figure below them is the server's.
function recount(d, { total = 0, done = 0 }) {
  const total_items = Math.max(0, (d.total_items || 0) + total)
  const completed_items = Math.max(0, (d.completed_items || 0) + done)
  const contracted = Math.max(Number(d.bulk_deal_quantity) || 0, total_items)
  const delivered = total_items > 0 ? completed_items : (Number(d.bulk_deal_completed) || 0)
  const delivery_pct = contracted > 0 ? Math.min(100, Math.round((delivered / contracted) * 100)) : 0
  return {
    ...d, total_items, completed_items, contracted, delivered, delivery_pct,
    paid_ahead: (d.paid_pct || 0) - delivery_pct >= 25 && delivery_pct < 100 && !d.stalled,
    unit_cost: contracted > 0 ? (Number(d.deal_total) || 0) / contracted : null,
    effective_unit_cost: delivered > 0 ? (Number(d.deal_total) || 0) / delivered : null,
  }
}

function Stat({ label, value }) {
  return (
    <div className="card px-5 py-4">
      <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold text-ink mt-1 tabular-nums break-words">{value}</p>
    </div>
  )
}

function Chip({ children, tone = 'neutral', title, onClick }) {
  const tones = {
    neutral: 'bg-elev text-ink-muted',
    info: 'bg-info/10 text-info',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
  }
  const cls = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${tones[tone]}`
  return onClick
    ? <button onClick={onClick} title={title} className={`${cls} hover:opacity-80`}>{children}</button>
    : <span title={title} className={cls}>{children}</span>
}

function Bar({ pct, tone }) {
  const fill = { blue: 'bg-info', green: 'bg-success', amber: 'bg-warning' }[tone] || 'bg-info'
  return (
    <div className="w-[110px] h-1.5 bg-elev rounded overflow-hidden ml-auto">
      <div className={`h-full rounded transition-all duration-300 ${fill}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

function DealCard({
  deal, expanded, items, loadingItems, newTitle, onToggle, onSetNewTitle, onAddItem,
  onLogGhost, onUpdateItem, onDeleteItem, onPatchDeal, onArchive, onEditSocials,
}) {
  const handles = socialsList(deal.social_handles)
  const unit = deal.bulk_deal_unit || 'items'
  const pct = deal.delivery_pct || 0
  const paidPct = deal.paid_pct || 0

  return (
    <div className="card overflow-hidden">
      <div onClick={onToggle} className="px-5 py-4 cursor-pointer flex items-center gap-3 hover:bg-elev transition-colors">
        {expanded ? <ChevronDown size={16} className="text-ink-muted flex-shrink-0" /> : <ChevronRight size={16} className="text-ink-muted flex-shrink-0" />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <PayeeLink payee={deal.payee} className="text-sm font-bold text-ink" />
            {deal.artist && <span className="text-xs text-ink-muted">{deal.artist}</span>}
            {deal.split_count > 0 && <Chip tone="info">{deal.split_count + 1} artists</Chip>}
            {deal.category && <Chip>{deal.category}</Chip>}
            {handles.length ? (
              <Chip tone="info" title={handles.map(h => h.display).join('\n')} onClick={(e) => { e.stopPropagation?.(); onEditSocials() }}>
                <AtSign size={9} /> <span className="truncate max-w-[140px] normal-case">{handles[0].display}</span>
                {handles.length > 1 && <span className="font-bold">+{handles.length - 1}</span>}
              </Chip>
            ) : (
              // Missing handles is a real gap: without them nothing on the
              // reconciliation views can tell you WHO was paid to post.
              <Chip tone="warning" title="Add the creators' social handles for this deal" onClick={(e) => { e.stopPropagation?.(); onEditSocials() }}>
                <Plus size={9} /> Add socials
              </Chip>
            )}
            {deal.stalled && (
              <Chip tone="danger" title={`Paid ${paidPct}% but nothing delivered in ${deal.stalled_days} days — chase the vendor or pause further payments.`}>
                Stalled {deal.stalled_days}d
              </Chip>
            )}
            {deal.paid_ahead && (
              <Chip tone="warning" title={`Paid ${paidPct}% but only ${pct}% delivered — consider holding further tranches until deliverables catch up.`}>
                Paid ahead
              </Chip>
            )}
          </div>
          {deal.description && <div className="text-xs text-ink-muted mt-0.5 truncate max-w-[500px]">{deal.description}</div>}
        </div>

        <div className="text-right flex-shrink-0">
          <div className="text-sm font-bold text-ink tabular-nums">{fmt(deal.deal_total, deal.currency)}</div>
          {deal.unit_cost != null && (
            <div className="text-[10px] font-bold text-ink-muted tabular-nums">{fmt(deal.unit_cost, deal.currency)}/{singularUnit(deal.bulk_deal_unit)}</div>
          )}
          <div className="text-[11px] text-ink-faint">{formatDate(deal.invoice_date, '—')}</div>
        </div>

        <div className="flex-shrink-0 text-right min-w-[130px]">
          <div className={`text-xs font-bold ${pct === 100 ? 'text-success' : 'text-ink-muted'}`}>
            {deal.delivered}/{deal.contracted || '—'} {unit}
          </div>
          <div className="mt-1"><Bar pct={pct} tone={pct === 100 ? 'green' : 'blue'} /></div>
          {/* The second half of the risk view. Delivery alone says nothing about
              exposure; the gap between these two bars IS the exposure. */}
          <div className={`text-[10px] font-bold mt-1.5 ${deal.paid_ahead ? 'text-warning' : 'text-ink-muted'}`}
            title={`${fmt(deal.paid_total, deal.currency)} of ${fmt(deal.deal_total, deal.currency)} paid`}>
            Paid {paidPct}%
          </div>
          <div className="mt-0.5"><Bar pct={paidPct} tone={deal.paid_ahead ? 'amber' : 'green'} /></div>
        </div>

        {pct === 100 && (
          <button
            onClick={e => { e.stopPropagation(); onArchive() }}
            title="Move to completed"
            className="btn-primary text-xs flex-shrink-0 whitespace-nowrap"
          ><Archive size={12} /> Complete</button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-divider px-5 pt-3 pb-4">
          <DealParams deal={deal} onPatch={onPatchDeal} />
          <SocialsRow handles={handles} onEdit={onEditSocials} />
          <SplitSection deal={deal} />

          {loadingItems ? (
            <div className="flex justify-center py-5"><Loader2 size={16} className="animate-spin text-ink-muted" /></div>
          ) : (
            <>
              {items.length === 0 && <p className="text-ink-muted text-[13px] text-center py-3">No deliverables logged yet.</p>}
              {items.map(item => (
                <ItemRow key={item.id} item={item} onUpdate={onUpdateItem} onDelete={() => onDeleteItem(item)} />
              ))}
              <GhostSlots deal={deal} logged={items.length} onLog={onLogGhost} />
              <div className="flex items-center gap-2 mt-2.5">
                <Plus size={16} className="text-ink-muted flex-shrink-0" />
                <input
                  value={newTitle}
                  onChange={e => onSetNewTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAddItem() } }}
                  placeholder="Add deliverable…"
                  className="input !py-1.5 text-[13px] flex-1"
                />
                <button onClick={onAddItem} disabled={!newTitle.trim()} className="btn-primary text-xs whitespace-nowrap">Add</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Quantity + unit ARE the deal's terms, and the blur-saved inputs are the only
// place they can be corrected once an invoice is approved. Without a quantity
// there is no contracted figure, so no progress bar and no ghost slots — the
// hint says so rather than showing a silent zero.
function DealParams({ deal, onPatch }) {
  const perUnit = deal.bulk_deal_quantity
    ? `${fmt((Number(deal.deal_total) || 0) / deal.bulk_deal_quantity, deal.currency)} per ${singularUnit(deal.bulk_deal_unit)}`
    : 'Set a quantity to see per-unit cost and contracted slots'
  return (
    <div className="flex items-center gap-2 flex-wrap mb-3.5 pb-3 border-b border-divider">
      <span className="text-[10px] uppercase tracking-wide font-bold text-ink-muted whitespace-nowrap">Deal:</span>
      <input
        type="number" min="1"
        key={`q${deal.id}:${deal.bulk_deal_quantity ?? ''}`}
        defaultValue={deal.bulk_deal_quantity ?? ''}
        placeholder="#"
        onBlur={e => {
          const v = e.target.value ? parseInt(e.target.value, 10) : null
          if (v !== (deal.bulk_deal_quantity ?? null)) onPatch({ bulk_deal_quantity: v })
        }}
        className="input !py-1.5 !w-16 text-xs font-bold text-center"
      />
      <input
        key={`u${deal.id}:${deal.bulk_deal_unit ?? ''}`}
        defaultValue={deal.bulk_deal_unit ?? ''}
        placeholder="videos, posts, etc."
        onBlur={e => {
          const v = e.target.value.trim() || null
          if (v !== (deal.bulk_deal_unit ?? null)) onPatch({ bulk_deal_unit: v })
        }}
        className="input !py-1.5 !w-44 text-xs"
      />
      <span className="text-[11px] text-ink-muted">{perUnit}</span>
    </div>
  )
}

function SocialsRow({ handles, onEdit }) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-3.5 pb-3 border-b border-divider">
      <span className="text-[10px] uppercase tracking-wide font-bold text-ink-muted inline-flex items-center gap-1"><AtSign size={10} /> Socials:</span>
      {handles.map((h, i) => (
        <Chip key={i} tone="info" onClick={onEdit} title="Click to edit"><AtSign size={9} /> <span className="normal-case">{h.display}</span></Chip>
      ))}
      <Chip tone={handles.length ? 'neutral' : 'warning'} onClick={onEdit}>
        <Plus size={9} /> {handles.length ? 'Edit socials' : 'Add socials'}
      </Chip>
    </div>
  )
}

// Read-only view of the artist split, plus the routes to change it. Splitting
// MOVES MONEY (it rewrites the parent's amount and creates child expense rows),
// so this surface shows the family and hands the edit to the ledger drawer
// rather than becoming a third place that can rewrite a family.
function SplitSection({ deal }) {
  const splits = Array.isArray(deal.splits) ? deal.splits : []
  return (
    <div className="mb-3.5 pb-3 border-b border-divider">
      <div className="flex items-center gap-2 mb-1.5">
        <Users size={14} className="text-ink-muted" />
        <span className="text-[10px] uppercase tracking-wide font-bold text-ink-muted">Artist split</span>
        {splits.length > 0 && <Chip tone="info">{splits.length} artists</Chip>}
      </div>
      {splits.length === 0 ? (
        <p className="text-[11px] text-ink-faint">
          Not split. Split this invoice across artists from the{' '}
          <a href={`/ledger?focus=${deal.id}`} target="_blank" rel="noopener noreferrer" className="text-brand-ink hover:underline">ledger entry</a>
          {' '}— the split rewrites the expense family, so it lives with the money.
        </p>
      ) : (
        <div className="space-y-1">
          {splits.map(s => (
            <div key={s.id} className="flex items-center gap-2 text-xs">
              <span className="text-ink font-medium truncate flex-1">{s.artist || '—'}</span>
              {s.song && <span className="text-ink-muted truncate flex-1">{s.song}</span>}
              <span className="text-ink tabular-nums font-semibold">{fmt(s.amount, deal.currency)}</span>
            </div>
          ))}
          <a href={`/ledger?focus=${deal.id}`} target="_blank" rel="noopener noreferrer" className="inline-block text-[11px] text-brand-ink hover:underline pt-0.5">
            Edit split on the ledger entry →
          </a>
        </div>
      )}
    </div>
  )
}

function ItemRow({ item, onUpdate, onDelete }) {
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-divider">
      <button onClick={() => onUpdate(item.id, { completed: !item.completed })} className="flex-shrink-0" title={item.completed ? 'Mark not received' : 'Mark received'}>
        {item.completed ? <CheckCircle2 size={20} className="text-success" /> : <Circle size={20} className="text-ink-faint" />}
      </button>
      <input
        key={`t${item.id}:${item.title}`}
        defaultValue={item.title}
        onBlur={e => { const v = e.target.value.trim(); if (v && v !== item.title) onUpdate(item.id, { title: v }) }}
        className={`flex-1 min-w-0 border-none outline-none bg-transparent py-1 text-[13px] font-semibold ${item.completed ? 'line-through text-ink-muted' : 'text-ink'}`}
      />
      {/* The platform travels with the evidence link into Artist Campaigns —
          "a link" and "an Instagram Reel" are not the same claim. */}
      <select
        value={item.platform || ''}
        onChange={e => onUpdate(item.id, { platform: e.target.value || null })}
        title="Platform this deliverable was posted on"
        className={`input !py-1 !w-28 text-xs flex-shrink-0 ${item.platform ? 'text-ink' : 'text-ink-muted'}`}
      >
        <option value="">Platform…</option>
        {DELIVERABLE_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
        {item.platform && !DELIVERABLE_PLATFORMS.includes(item.platform) && <option value={item.platform}>{item.platform}</option>}
      </select>
      <input
        key={`u${item.id}:${item.url || ''}`}
        defaultValue={item.url || ''}
        placeholder="Paste link…"
        onBlur={e => { const v = e.target.value.trim(); if (v !== (item.url || '')) onUpdate(item.id, { url: v || null }) }}
        className="input !py-1 !w-[180px] text-xs flex-shrink-0"
      />
      {item.url && (
        <a href={/^https?:\/\//.test(item.url) ? item.url : `https://${item.url}`} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-brand-ink" title="Open link">
          <ExternalLink size={14} />
        </a>
      )}
      {item.completed_at && <span className="text-[10px] text-ink-faint whitespace-nowrap flex-shrink-0">{formatDate(item.completed_at, '')}</span>}
      <button onClick={onDelete} className="text-ink-faint hover:text-danger flex-shrink-0" title="Remove"><Trash2 size={14} /></button>
    </div>
  )
}

// Contracted-but-unlogged deliverables, as dashed placeholders. No DB rows are
// written until "Log" is clicked, so a 10-video deal shows the eight nobody has
// typed yet without filling the table with junk. Capped so a quantity-500 deal
// doesn't render a wall.
function GhostSlots({ deal, logged, onLog }) {
  const missing = Math.min(Math.max(0, (deal.contracted || 0) - logged), GHOST_CAP)
  if (!missing) return null
  const name = singularUnit(deal.bulk_deal_unit)
  const cap = name.charAt(0).toUpperCase() + name.slice(1)
  return Array.from({ length: missing }, (_, i) => {
    const n = logged + i + 1
    return (
      <div key={`ghost-${n}`} className="flex items-center gap-2.5 py-2 border-b border-dashed border-divider">
        <Circle size={20} className="text-ink-faint opacity-50 flex-shrink-0" />
        <span className="flex-1 text-[13px] text-ink-muted italic">{cap} {n} — contracted, not yet logged</span>
        <button
          onClick={() => onLog(`${cap} ${n}`)}
          className="rounded-lg border border-dashed border-rule px-2.5 py-0.5 text-[11px] font-bold text-ink-muted hover:bg-elev"
          title="Create this deliverable so it can be checked off and carry a link"
        >Log</button>
      </div>
    )
  })
}

// Saves the JSONB `social_handles` on the expense via the normal ledger PATCH,
// so the handles surface on every reconciliation view, not just here.
function SocialsModal({ deal, onClose, onSaved }) {
  const { toast } = useToast()
  const existing = socialsList(deal.social_handles)
  const [rows, setRows] = useState(existing.length
    ? existing.map(s => ({ platform: s.platform || 'Instagram', handle: s.handle, artist: s.artist || '', amount: s.amount ?? '' }))
    : [{ platform: 'Instagram', handle: '', artist: '', amount: '' }])
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const cleaned = rows.map(r => {
      const handle = (r.handle || '').trim()
      if (!handle) return null
      const out = { platform: (r.platform || 'Instagram').trim(), handle }
      const artist = (r.artist || '').trim()
      if (artist) out.artist = artist
      const amt = parseFloat(r.amount)
      if (Number.isFinite(amt) && amt > 0) out.amount = amt
      return out
    }).filter(Boolean)
    setSaving(true)
    try {
      await api.patch(`/ledger/entries/${deal.id}`, { social_handles: cleaned })
      toast('Socials updated')
      onSaved(cleaned)
    } catch (err) { toast(err.response?.data?.error || 'Failed to save socials', 'error') }
    finally { setSaving(false) }
  }

  // Running total against the deal, in the DEAL's currency. Per-creator amounts
  // that don't add up to the invoice mean somebody was left off.
  const sum = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const dealAmt = Number(deal.deal_total) || 0
  const balanced = dealAmt > 0 && Math.abs(sum - dealAmt) < 0.01

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      title={`Socials — ${deal.payee || 'deal'}`}
      size="xl"
      footer={
        <>
          <button onClick={onClose} disabled={saving} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <SocialHandlesEditor value={rows} onChange={setRows} currency={deal.currency || 'USD'} disabled={saving} />
      {sum > 0 && (
        <div className={`text-xs rounded-lg px-3 py-2 mt-3 flex items-center justify-between ${
          balanced ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
        }`}>
          <span className="font-semibold">
            Total: <span className="tabular-nums">{fmt(sum, deal.currency)}</span>
            {dealAmt > 0 && <> of <span className="tabular-nums">{fmt(dealAmt, deal.currency)}</span> deal</>}
          </span>
          {dealAmt > 0 && !balanced && (
            <span className="font-bold tabular-nums">
              {dealAmt - sum > 0 ? `${fmt(dealAmt - sum, deal.currency)} left` : `${fmt(sum - dealAmt, deal.currency)} over`}
            </span>
          )}
          {balanced && <CheckCircle2 size={14} />}
        </div>
      )}
      {deal.family_artists?.length > 1 && (
        <p className="text-[11px] text-ink-muted mt-2">
          This deal is split across {deal.family_artists.join(', ')} — use the “For artist” column to tag which artist each creator posted for. Blank means shared.
        </p>
      )}
    </Modal>
  )
}

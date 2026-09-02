import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Loader, Lock, CheckCircle2, FileText, ChevronRight, Search, RefreshCw } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { moneyOrig } from '../utils/money'

// ── Recording budget index ─────────────────────────────────────────
// Rows link into /recording-budgets/:id — a budget is a document with its own
// URL, not an inline expander. "New budget" POSTs a blank draft and navigates
// straight into it: the header grid IS the form, so there is no pre-form to
// fill in and nothing is required up front.

const STATUS_TONE = {
  draft: { cls: 'bg-gray-100 text-gray-700', icon: null },
  approved: { cls: 'bg-emerald-100 text-emerald-800', icon: <CheckCircle2 size={11} /> },
  locked: { cls: 'bg-slate-200 text-slate-800', icon: <Lock size={11} /> },
}

export default function RecordingBudgets() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [budgets, setBudgets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const load = () => {
    setLoading(true)
    api.get('/recording-budgets')
      .then(r => { setBudgets(r.data?.data || []); setError(null) })
      .catch(err => setError(err.response?.data?.error || err.message || 'Failed to load budgets'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const create = async () => {
    if (creating) return
    setCreating(true)
    try {
      const r = await api.post('/recording-budgets', { type: 'budget', currency: 'USD' })
      const id = r.data?.data?.id
      if (id) navigate(`/recording-budgets/${id}`)
      else load()
    } catch (err) {
      toast(err.response?.data?.error || 'Could not create the budget', 'error')
    } finally { setCreating(false) }
  }

  const filtered = budgets.filter(b => {
    if (statusFilter && b.status !== statusFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (b.artist_display || '').toLowerCase().includes(q) || (b.project_title || '').toLowerCase().includes(q)
  })

  // Roll-ups follow the FILTER — the strip describes what is on screen.
  const totals = filtered.reduce((a, b) => ({
    total_budget: a.total_budget + (Number(b.total_budget) || 0),
    advance: a.advance + (Number(b.advance_amount) || 0),
    draft: a.draft + (b.status === 'draft' ? 1 : 0),
    approved: a.approved + (b.status === 'approved' ? 1 : 0),
    locked: a.locked + (b.status === 'locked' ? 1 : 0),
  }), { total_budget: 0, advance: 0, draft: 0, approved: 0, locked: 0 })

  return (
    <div>
      <PageHeader
        title="Recording Budgets"
        subtitle="Draft, approve and track recording budgets against actual spend. Modelled on the Recording Budget, Fund and Costs-to-Date templates."
        action={
          <button type="button" onClick={create} disabled={creating} className="btn-primary">
            {creating ? <Loader size={15} className="animate-spin" /> : <Plus size={15} />}
            {creating ? 'Creating…' : 'New budget'}
          </button>
        }
      />

      {budgets.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <Stat label="Total budgeted" value={moneyOrig(totals.total_budget, 'USD')}
            sub={`${filtered.length} budget${filtered.length === 1 ? '' : 's'} shown`} />
          <Stat label="Advances" value={moneyOrig(totals.advance, 'USD')} />
          <Stat label="Draft" value={totals.draft} tone="text-ink-muted" />
          <Stat label="Approved" value={totals.approved} tone="text-success" />
          <Stat label="Locked" value={totals.locked} tone="text-ink" />
        </div>
      )}

      <div className="card px-4 py-3 flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search artist or project…" className="input !py-1.5 !pl-7 text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input !py-1.5 text-sm !w-auto">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="approved">Approved</option>
          <option value="locked">Locked</option>
        </select>
      </div>

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={5} cols={4} /></div>
      ) : error ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-danger mb-3">{error}</p>
          <button onClick={load} className="btn-secondary mx-auto"><RefreshCw size={14} /> Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          {budgets.length === 0 ? (
            <>
              <FileText size={28} className="text-ink-faint mx-auto mb-3" />
              <p className="text-sm text-ink-muted">No budgets yet. Click <span className="font-semibold">New budget</span> to start one.</p>
            </>
          ) : <p className="text-sm text-ink-muted">No budgets match your filters.</p>}
        </div>
      ) : (
        <div className="space-y-2">{filtered.map(b => <BudgetRow key={b.id} b={b} />)}</div>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone = 'text-ink' }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold tabular-nums mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-ink-faint mt-0.5">{sub}</p>}
    </div>
  )
}

function BudgetRow({ b }) {
  const tone = STATUS_TONE[b.status] || STATUS_TONE.draft
  const typeTone = b.type === 'fund'
    ? 'bg-brand-500/15 text-brand-ink ring-1 ring-brand-500/30'
    : 'bg-sky-100 text-sky-700 ring-1 ring-sky-200'
  const showRight = Number(b.advance_amount) > 0 || (b.type === 'fund' && Number(b.fund_amount) > 0)
  return (
    <Link to={`/recording-budgets/${b.id}`} className="card block p-4 hover:border-brand-500/40 transition-colors">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-ink truncate">
              {b.artist_display || <span className="text-ink-faint italic font-normal">Unnamed artist</span>}
            </span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${typeTone}`}>
              {b.type === 'fund' ? 'Fund' : 'Budget'}
            </span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${tone.cls}`}>
              {tone.icon}{b.status}
            </span>
          </div>
          <p className="text-xs text-ink-muted mt-1">
            {b.project_title || <span className="text-ink-faint italic">no project title</span>}
            {b.proposed_tracks ? <span className="text-ink-faint"> · {b.proposed_tracks} track{b.proposed_tracks === 1 ? '' : 's'}</span> : null}
            <span className="text-ink-faint mx-2">·</span>
            {b.line_item_count} line item{b.line_item_count === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold">Total</p>
            <p className="text-sm font-bold text-ink tabular-nums">{moneyOrig(b.total_budget, b.currency)}</p>
          </div>
          {showRight && (
            <div className="text-right">
              <p className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold">{b.type === 'fund' ? 'Fund' : 'Advance'}</p>
              <p className="text-sm font-semibold text-ink-muted tabular-nums">
                {moneyOrig(b.type === 'fund' ? b.fund_amount : b.advance_amount, b.currency)}
              </p>
            </div>
          )}
          <ChevronRight size={16} className="text-ink-faint" />
        </div>
      </div>
    </Link>
  )
}

import { useEffect, useState } from 'react'
import { Send, X, Plus, MessageSquare, Wallet } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { BUDGET_CATEGORIES } from '../constants'

// Comments thread + budget (cap + line items) for a release. Both endpoints
// are label-scoped and re-validate the release on write.
// `section` selects which panel(s) to render: 'budget', 'comments', or (default)
// both side by side. `bare` drops the card chassis + heading, for use inside a
// tab that already provides them.
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function ReleaseExtras({ releaseId, budgetCap, onCapChange, section = 'both', bare = false }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)

  const [comments, setComments] = useState(null)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [budget, setBudget] = useState({ items: [], total: 0, budget_cap: budgetCap })
  const [budgetLoading, setBudgetLoading] = useState(true)
  const [item, setItem] = useState({ category: '', description: '', amount: '' })
  const [savingItem, setSavingItem] = useState(false)

  const loadComments = () => api.get(`/releases/${releaseId}/comments`).then(r => setComments(r.data.data || [])).catch(() => setComments([]))
  const loadBudget = () => api.get(`/releases/${releaseId}/budget`)
    .then(r => setBudget(r.data.data)).catch(() => {}).finally(() => setBudgetLoading(false))
  useEffect(() => { loadComments(); loadBudget() }, [releaseId])

  const addComment = async () => {
    if (!body.trim() || posting) return
    setPosting(true)
    try { await api.post(`/releases/${releaseId}/comments`, { body: body.trim() }); setBody(''); await loadComments() }
    catch { toast('Failed to post comment', 'error') }
    finally { setPosting(false) }
  }
  const delComment = async (id) => {
    try { await api.delete(`/releases/${releaseId}/comments/${id}`); loadComments() }
    catch (err) { toast(err.response?.data?.error || 'Failed to delete', 'error') }
  }

  const addItem = async () => {
    if (!item.category) { toast('Pick a category', 'error'); return }
    if (item.amount === '') { toast('Amount is required', 'error'); return }
    setSavingItem(true)
    try { await api.post(`/releases/${releaseId}/budget/items`, item); setItem({ category: '', description: '', amount: '' }); await loadBudget() }
    catch { toast('Failed to add line item', 'error') }
    finally { setSavingItem(false) }
  }
  const delItem = async (id) => {
    try { await api.delete(`/releases/${releaseId}/budget/items/${id}`); loadBudget() }
    catch { toast('Failed to delete line item', 'error') }
  }

  // ── Budget ─────────────────────────────────────────────────────────────
  const items = budget.items || []
  const cap = budget.budget_cap != null ? parseFloat(budget.budget_cap) : null
  const total = items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
  const used = cap ? total / cap : 0

  // Group by the release budget categories, in their declared order. Anything
  // with an unrecognised category falls into Other rather than vanishing.
  const known = new Set(BUDGET_CATEGORIES)
  const byCategory = BUDGET_CATEGORIES
    .map(cat => [cat, items.filter(i => i.category === cat)])
    .filter(([, list]) => list.length)
  const stray = items.filter(i => !known.has(i.category))
  if (stray.length) {
    const other = byCategory.find(([c]) => c === 'Other')
    if (other) other[1] = [...other[1], ...stray]
    else byCategory.push(['Other', stray])
  }

  const budgetBody = (
    <div className="space-y-6">
      {/* Summary bar */}
      {(items.length > 0 || cap != null) && (
        <div className="flex items-center gap-6 pb-5 border-b border-divider flex-wrap">
          <div>
            <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-0.5">Total planned</p>
            <p className="text-xl font-bold text-ink tabular-nums">{money(total)}</p>
          </div>
          {cap != null && (
            <>
              <div>
                <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-0.5">Budget cap</p>
                <p className="text-xl font-bold text-ink tabular-nums">{money(cap)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-0.5">Remaining</p>
                <p className={`text-xl font-bold tabular-nums ${cap - total < 0 ? 'text-danger' : 'text-success'}`}>
                  {money(Math.abs(cap - total))}{cap - total < 0 ? ' over' : ' left'}
                </p>
              </div>
              <div className="flex-1 min-w-[120px]">
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${used > 1 ? 'bg-danger' : used > 0.8 ? 'bg-warning' : 'bg-success'}`}
                    style={{ width: `${Math.min(100, used * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-ink-muted mt-1 tabular-nums">{Math.round(used * 100)}% used</p>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="text-xs font-bold text-ink-muted uppercase tracking-wider">Cap</label>
        <input
          type="number" step="0.01" placeholder="No cap"
          defaultValue={budget.budget_cap ?? ''}
          onBlur={e => onCapChange?.(e.target.value)}
          className="input !py-1.5 text-sm !w-36"
        />
      </div>

      {/* Line items, grouped by category with per-category totals */}
      {budgetLoading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : !items.length ? (
        <p className="text-sm text-ink-muted">No line items yet. Add one below.</p>
      ) : (
        <div className="space-y-5">
          {byCategory.map(([cat, list]) => {
            const catTotal = list.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
            return (
              <div key={cat}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-bold text-ink-muted uppercase tracking-widest whitespace-nowrap">{cat}</span>
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-xs font-semibold text-ink-muted tabular-nums">{money(catTotal)}</span>
                </div>
                <div className="space-y-1">
                  {list.map(it => (
                    <div key={it.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 group">
                      <span className="flex-1 min-w-0 text-sm text-ink truncate">
                        {it.description || <span className="text-ink-faint italic">No description</span>}
                      </span>
                      <span className="text-sm font-semibold text-ink tabular-nums flex-shrink-0">{money(it.amount)}</span>
                      <button onClick={() => delItem(it.id)} aria-label="Delete line item" className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-faint hover:text-danger flex-shrink-0"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add form */}
      <div className="pt-4 border-t border-divider">
        <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-3">Add line item</p>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="label">Category</label>
            <select value={item.category} onChange={e => setItem(s => ({ ...s, category: e.target.value }))} className="input !py-1.5 text-sm">
              <option value="">— Select —</option>
              {BUDGET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="label">Description</label>
            <input value={item.description} onChange={e => setItem(s => ({ ...s, description: e.target.value }))} placeholder="e.g. Director fee" className="input !py-1.5 text-sm" />
          </div>
          <div className="w-28">
            <label className="label">Amount ($)</label>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={item.amount} onChange={e => setItem(s => ({ ...s, amount: e.target.value }))} className="input !py-1.5 text-sm" />
          </div>
          <button onClick={addItem} disabled={savingItem || !item.category || item.amount === ''} className="btn-primary !py-1.5 text-xs flex-shrink-0 disabled:opacity-40">
            <Plus size={13} /> {savingItem ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )

  // ── Comments ───────────────────────────────────────────────────────────
  const commentsBody = (
    <div className="space-y-4">
      {comments === null ? (
        <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
      ) : !comments.length ? (
        <p className="py-6 text-center text-sm text-ink-muted">No comments yet. Be the first.</p>
      ) : (
        <div className="divide-y divide-divider max-h-80 overflow-y-auto">
          {comments.map(c => (
            <div key={c.id} className="flex items-start gap-3 py-3 group">
              <div className="w-7 h-7 rounded-full bg-brand-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-brand-ink">{c.author?.charAt(0)?.toUpperCase() || '?'}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-ink">{c.author || 'Someone'}</span>
                  <span className="text-xs text-ink-muted">{new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                </div>
                <p className="text-sm text-ink mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
              </div>
              {/* Mirrors the server rule: author or Admin. */}
              {(c.user_id === user?.id || isAdmin) && (
                <button onClick={() => delComment(c.id)} aria-label="Delete comment" className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-ink-faint hover:text-danger flex-shrink-0"><X size={12} /></button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-start gap-3 pt-2 border-t border-divider">
        <textarea
          rows={2} value={body} onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment() }}
          placeholder="Add a comment… (⌘+Enter to post)"
          className="input resize-none flex-1"
        />
        <button onClick={addComment} disabled={!body.trim() || posting} className="btn-primary self-end flex-shrink-0 disabled:opacity-40">
          <Send size={13} /> {posting ? '…' : 'Post'}
        </button>
      </div>
    </div>
  )

  const wrap = (icon, title, inner) => (bare ? inner : (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">{icon}<h2 className="text-sm font-bold text-ink">{title}</h2></div>
      {inner}
    </div>
  ))

  const budgetPanel = wrap(<Wallet size={15} className="text-brand-ink" />, 'Budget', budgetBody)
  const commentsPanel = wrap(<MessageSquare size={15} className="text-brand-ink" />, 'Comments', commentsBody)

  if (section === 'budget') return budgetPanel
  if (section === 'comments') return commentsPanel
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">{budgetPanel}{commentsPanel}</div>
}

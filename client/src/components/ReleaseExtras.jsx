import { useEffect, useState } from 'react'
import { Send, Trash2, Plus, MessageSquare, Wallet } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { EXPENSE_CATEGORIES } from '../constants'

// Comments thread + budget (cap + line items) for a release. Both endpoints
// are label-scoped and re-validate the release on write.
export default function ReleaseExtras({ releaseId, budgetCap, onCapChange }) {
  const { toast } = useToast()
  const [comments, setComments] = useState([])
  const [body, setBody] = useState('')
  const [budget, setBudget] = useState({ items: [], total: 0, budget_cap: budgetCap })
  const [item, setItem] = useState({ category: '', description: '', amount: '' })

  const loadComments = () => api.get(`/releases/${releaseId}/comments`).then(r => setComments(r.data.data || [])).catch(() => {})
  const loadBudget = () => api.get(`/releases/${releaseId}/budget`).then(r => setBudget(r.data.data)).catch(() => {})
  useEffect(() => { loadComments(); loadBudget() }, [releaseId])

  const addComment = async () => {
    if (!body.trim()) return
    try { await api.post(`/releases/${releaseId}/comments`, { body: body.trim() }); setBody(''); loadComments() }
    catch { toast('Failed', 'error') }
  }
  const delComment = async (id) => { try { await api.delete(`/releases/${releaseId}/comments/${id}`); loadComments() } catch { toast('Failed', 'error') } }

  const addItem = async () => {
    if (!item.amount) { toast('Amount is required', 'error'); return }
    try { await api.post(`/releases/${releaseId}/budget/items`, item); setItem({ category: '', description: '', amount: '' }); loadBudget() }
    catch { toast('Failed', 'error') }
  }
  const delItem = async (id) => { try { await api.delete(`/releases/${releaseId}/budget/items/${id}`); loadBudget() } catch { toast('Failed', 'error') } }
  const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  const overCap = budget.budget_cap != null && budget.total > Number(budget.budget_cap)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      {/* Budget */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3"><Wallet size={15} className="text-brand-600" /><h2 className="text-sm font-bold text-ink">Budget</h2></div>
        <div className="flex items-center gap-2 mb-3">
          <input type="number" step="0.01" placeholder="Budget cap" defaultValue={budget.budget_cap ?? ''} onBlur={e => onCapChange?.(e.target.value)} className="input !py-1.5 text-sm !w-36" />
          <span className={`text-sm ${overCap ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>Planned {money(budget.total)}{budget.budget_cap != null ? ` / ${money(budget.budget_cap)}` : ''}</span>
        </div>
        <div className="space-y-1.5 mb-3">
          {budget.items.map(it => (
            <div key={it.id} className="flex items-center gap-2 text-sm py-1 border-b border-divider group">
              <span className="flex-1 text-ink">{it.category || 'Uncategorized'}{it.description ? ` · ${it.description}` : ''}</span>
              <span className="text-gray-600">{money(it.amount)}</span>
              <button onClick={() => delItem(it.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>
            </div>
          ))}
          {!budget.items.length && <p className="text-sm text-gray-400">No line items yet.</p>}
        </div>
        <div className="flex gap-2">
          <select value={item.category} onChange={e => setItem(s => ({ ...s, category: e.target.value }))} className="input !py-1.5 text-sm"><option value="">Category</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
          <input type="number" step="0.01" placeholder="Amount" value={item.amount} onChange={e => setItem(s => ({ ...s, amount: e.target.value }))} className="input !py-1.5 text-sm !w-28" />
          <button onClick={addItem} className="btn-primary !py-1.5 text-xs flex-shrink-0"><Plus size={13} /></button>
        </div>
      </div>

      {/* Comments */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3"><MessageSquare size={15} className="text-brand-600" /><h2 className="text-sm font-bold text-ink">Comments</h2></div>
        <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
          {comments.map(c => (
            <div key={c.id} className="group">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-400">{c.author || 'Someone'} · {new Date(c.created_at).toLocaleString()}</p>
                <button onClick={() => delComment(c.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600"><Trash2 size={12} /></button>
              </div>
              <p className="text-sm text-ink whitespace-pre-line">{c.body}</p>
            </div>
          ))}
          {!comments.length && <p className="text-sm text-gray-400">No comments yet.</p>}
        </div>
        <div className="flex gap-2">
          <input value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComment()} placeholder="Add a comment…" className="input !py-1.5 text-sm" />
          <button onClick={addComment} className="btn-primary !py-1.5 text-xs flex-shrink-0"><Send size={13} /></button>
        </div>
      </div>
    </div>
  )
}

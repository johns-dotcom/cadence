import { useEffect, useState } from 'react'
import { Plus, Trash2, Check, X } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'

// Admin-curated rep list for this workspace. Names feed ledger/deal dropdowns.
// Deactivating keeps a rep on historical records but hides it from new entries.
export default function RepsManager() {
  const { toast } = useToast()
  const [reps, setReps] = useState([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => api.get('/reps', { params: { all: 1 } }).then(r => setReps(r.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  // Wrap, don't pass `load` directly: it returns a Promise, which React would
  // otherwise treat as the effect's cleanup function and crash on unmount.
  useEffect(() => { load() }, [])

  const add = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    try { await api.post('/reps', { name: name.trim() }); setName(''); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const toggle = async (rep) => {
    try { await api.patch(`/reps/${rep.id}`, { active: !rep.active }); load() }
    catch { toast('Failed', 'error') }
  }
  const remove = async (rep) => {
    if (!window.confirm(`Remove ${rep.name}?`)) return
    try { await api.delete(`/reps/${rep.id}`); load() } catch { toast('Failed', 'error') }
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-bold text-ink mb-1">Reps</h2>
      <p className="text-xs text-gray-400 mb-4">Names used in ledger and deal dropdowns across this workspace.</p>
      <form onSubmit={add} className="flex gap-2 mb-4">
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Add a rep name" />
        <button className="btn-primary flex-shrink-0"><Plus size={15} /> Add</button>
      </form>
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : reps.length === 0 ? (
        <p className="text-sm text-gray-400">No reps yet.</p>
      ) : (
        <div className="space-y-1.5">
          {reps.map(r => (
            <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 group">
              <span className={`flex-1 text-sm ${r.active ? 'text-ink' : 'text-gray-400 line-through'}`}>{r.name}</span>
              <button onClick={() => toggle(r)} title={r.active ? 'Deactivate' : 'Reactivate'}
                className={`text-xs font-semibold px-2 py-0.5 rounded ${r.active ? 'text-emerald-600' : 'text-gray-400'}`}>
                {r.active ? <Check size={14} /> : <X size={14} />}
              </button>
              <button onClick={() => remove(r)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

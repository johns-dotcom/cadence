import { useState } from 'react'
import { Scissors, X, Plus, Divide } from 'lucide-react'
import api from '../api'

const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`

// Split a ledger entry across artists/songs. The parent keeps the first slice;
// the rest become split children (POST /ledger/entries/:id/split). Slices must
// sum to the entry total; a running remainder footer goes emerald at zero,
// amber otherwise. Reused by the Ledger and the Artist Campaigns pages (the
// cross-artist entry point), so every row carries its own artist select.
//
// Re-split: an already-split entry opens with its existing breakdown prefilled
// and validates against the FAMILY total (the server replaces the children in
// one transaction). "Split evenly" divides cent-exactly, remainder on row 1.
export default function SplitModal({ entry, artistNames = [], toast, onClose, onDone }) {
  const isResplit = (entry.split_count || 0) > 0
  const total = Number((isResplit ? entry.family_amount : entry.amount) || 0)
  const existing = Array.isArray(entry.artist_breakdown?.splits) ? entry.artist_breakdown.splits : null
  const [rows, setRows] = useState(() =>
    isResplit && existing?.length >= 2
      ? existing.map(s => ({ artist: s.artist || '', song: s.song || '', amount: s.amount ?? '' }))
      : [
        { artist: entry.artist || '', song: entry.song || '', amount: '' },
        { artist: '', song: '', amount: '' },
      ])
  const [saving, setSaving] = useState(false)
  const setRow = (i, k) => (e) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [k]: e.target.value } : r))
  const sum = rows.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
  const remaining = Math.round((total - sum) * 100) / 100
  const balanced = Math.abs(remaining) < 0.01 && total > 0
  const addRow = () => setRows(rs => [...rs, { artist: '', song: '', amount: remaining > 0 ? remaining.toFixed(2) : '' }])
  const removeRow = (i) => setRows(rs => rs.length > 2 ? rs.filter((_, idx) => idx !== i) : rs)
  // Cent-exact even divider (boom's "Split evenly (N)"): remainder on row 1.
  const splitEvenly = () => {
    const n = rows.length
    if (!n || !(total > 0)) return
    const totalC = Math.round(total * 100)
    const eachC = Math.floor(totalC / n)
    setRows(rs => rs.map((r, i) => ({ ...r, amount: ((eachC + (i === 0 ? totalC - eachC * n : 0)) / 100).toFixed(2) })))
  }

  const submit = async () => {
    const splits = rows.map(r => ({ artist: r.artist.trim(), song: r.song.trim(), amount: parseFloat(r.amount) })).filter(r => r.amount > 0)
    if (splits.length < 2) { toast('Add at least two slices with amounts', 'error'); return }
    if (!balanced) { toast('Slices must sum to the entry total', 'error'); return }
    setSaving(true)
    try { await api.post(`/ledger/entries/${entry.id}/split`, { splits }); toast(`Split into ${splits.length} slices`); onDone() }
    catch (err) { toast(err.response?.data?.error || 'Could not split', 'error'); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-ink truncate flex items-center gap-2"><Scissors size={16} /> {isResplit ? 'Edit split' : 'Split'} · {entry.payee || 'entry'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button>
        </div>
        <p className="text-xs text-gray-400 mb-4">Divide {money(total, entry.currency)} across artists/songs. The parent keeps the first slice; the rest become split children.{isResplit ? ' Saving replaces the existing slices.' : ''}</p>
        <datalist id="split-artists">{artistNames.map(a => <option key={a} value={a} />)}</datalist>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input list="split-artists" className="input flex-1" placeholder="Artist" value={r.artist} onChange={setRow(i, 'artist')} />
              <input className="input flex-1" placeholder="Song (optional)" value={r.song} onChange={setRow(i, 'song')} />
              <input type="number" step="0.01" className="input w-28" placeholder="0.00" value={r.amount} onChange={setRow(i, 'amount')} />
              <button onClick={() => removeRow(i)} disabled={rows.length <= 2} className="text-gray-300 hover:text-danger disabled:opacity-30 p-1"><X size={15} /></button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-2">
          <button onClick={addRow} className="text-xs font-semibold text-brand-600 hover:underline inline-flex items-center gap-1"><Plus size={13} /> Add artist</button>
          <button onClick={splitEvenly} title="Divide the total cent-exactly across the rows (remainder on the first)" className="text-xs font-semibold text-brand-600 hover:underline inline-flex items-center gap-1"><Divide size={13} /> Split evenly ({rows.length})</button>
        </div>
        <div className={`mt-4 flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          <span>{balanced ? 'Balanced' : (remaining > 0 ? 'Remaining' : 'Over by')}</span>
          <span>{money(Math.abs(remaining), entry.currency)}</span>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={saving || !balanced} className="btn-primary">{saving ? 'Splitting…' : isResplit ? 'Replace split' : 'Split entry'}</button>
        </div>
      </div>
    </div>
  )
}

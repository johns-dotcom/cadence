import { Plus, X } from 'lucide-react'

// Per-entry social-handle rows (boom parity): platform / handle / for-artist /
// amount. Pure controlled editor — the parent owns the array and decides when
// it persists (Approvals PATCHes social_handles on save; the checklist deck
// passes it straight through). Rows with an empty handle are the parent's to
// strip before saving; rendering them here keeps in-progress typing alive.
const PLATFORMS = ['TikTok', 'Instagram', 'YouTube', 'X', 'Snapchat', 'Twitch', 'Other']

export default function SocialHandlesEditor({ value = [], onChange, currency = 'USD', disabled = false }) {
  const rows = Array.isArray(value) ? value : []
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const remove = (i) => onChange(rows.filter((_, j) => j !== i))
  const add = () => onChange([...rows, { platform: '', handle: '', artist: '', amount: '' }])

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select value={r.platform || ''} disabled={disabled} onChange={e => set(i, { platform: e.target.value })}
            className="input !py-1 !w-[110px] text-xs flex-shrink-0">
            <option value="">Platform</option>
            {PLATFORMS.map(p => <option key={p}>{p}</option>)}
            {r.platform && !PLATFORMS.includes(r.platform) && <option value={r.platform}>{r.platform}</option>}
          </select>
          <input value={r.handle || ''} disabled={disabled} onChange={e => set(i, { handle: e.target.value })}
            placeholder="@handle" className="input !py-1 text-xs flex-1 min-w-0" />
          <input value={r.artist || ''} disabled={disabled} onChange={e => set(i, { artist: e.target.value })}
            placeholder="For artist" className="input !py-1 text-xs flex-1 min-w-0" />
          <input type="number" step="0.01" value={r.amount ?? ''} disabled={disabled}
            onChange={e => set(i, { amount: e.target.value })}
            placeholder={currency} title={`Amount in ${currency} — amount-ed handles become their own split lines on approval`}
            className="input !py-1 text-xs !w-[92px] flex-shrink-0" />
          <button type="button" onClick={() => remove(i)} disabled={disabled}
            className="text-ink-faint hover:text-danger flex-shrink-0" title="Remove row"><X size={13} /></button>
        </div>
      ))}
      <button type="button" onClick={add} disabled={disabled}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-ink hover:underline">
        <Plus size={12} /> Add social handle
      </button>
    </div>
  )
}

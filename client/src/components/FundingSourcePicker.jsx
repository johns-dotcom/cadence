import { useState } from 'react'
import { Plus } from 'lucide-react'
import useFundingSources from '../hooks/useFundingSources'

// "Paid from" picker for the pay flows. The label account is the default (value
// ''), so a workspace that never adds a payer sees one inert option and nothing
// changes. Adding a payer inline keeps the pay flow uninterrupted — you don't
// leave the modal to record that Alice fronted this one.
//
// value: '' (label account) or a numeric source id. onChange(value:string).
export default function FundingSourcePicker({ value, onChange, label = 'Paid from', help }) {
  const { sources, addSource } = useFundingSources()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const active = sources.filter(s => s.active !== false)

  const add = async () => {
    const n = name.trim()
    if (!n) return
    setBusy(true)
    try {
      const src = await addSource(n)
      onChange(String(src.id))
      setAdding(false); setName('')
    } catch { /* keep the form open */ }
    finally { setBusy(false) }
  }

  return (
    <div>
      <label className="label">{label}</label>
      {adding ? (
        <div className="flex items-center gap-1.5">
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } if (e.key === 'Escape') { setAdding(false); setName('') } }}
            placeholder="Who paid out of pocket?" className="input" />
          <button type="button" disabled={busy} onClick={add} className="btn-primary !py-1.5 text-xs whitespace-nowrap">Add</button>
          <button type="button" onClick={() => { setAdding(false); setName('') }} className="btn-secondary !py-1.5 text-xs">Cancel</button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <select className="input" value={value || ''} onChange={e => onChange(e.target.value)}>
            <option value="">Label account (no reimbursement)</option>
            {active.map(s => <option key={s.id} value={s.id}>{s.name}{s.reimbursable === false ? '' : ' — out of pocket'}</option>)}
          </select>
          <button type="button" onClick={() => setAdding(true)} title="Add a payer" className="btn-secondary !py-1.5 !px-2"><Plus size={15} /></button>
        </div>
      )}
      {help && <p className="text-[11px] text-ink-faint mt-1">{help}</p>}
    </div>
  )
}

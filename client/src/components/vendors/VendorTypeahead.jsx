import { useEffect, useRef, useState } from 'react'
import api from '../../api'

// Debounced server-side vendor picker.
//
// A bare <select> over every payee is unusable at the scale this page exists
// for (the reference app's directory runs to 400 vendors), and it also cannot
// offer a name that isn't in the list — which the "link a bank descriptor to a
// vendor" flow needs. `/ledger/vendor-suggest` is the existing endpoint; this
// is the one client wrapper for it, so merge, bulk-merge, move-invoice and the
// unlinked-payee queue all behave identically.
export default function VendorTypeahead({
  value, onPick, placeholder = 'Search a vendor…', exclude = [], allowNew = false,
  autoFocus = false, className = '',
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  const skip = exclude.map((n) => String(n || '').toLowerCase())

  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    const t = setTimeout(() => {
      api.get('/ledger/vendor-suggest', { params: { q: q.trim() } })
        .then((r) => setHits((r.data.data?.vendors || []).filter((v) => !skip.includes(v.name.toLowerCase()))))
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [q, exclude.join('|')])

  // A click outside is a dismissal, not a selection — without this the list
  // stays open over whatever the user clicked next.
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (name) => { onPick(name); setQ(''); setHits([]); setOpen(false) }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        className="input !py-1.5 text-sm"
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={value || q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); if (value) onPick('') }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && allowNew && q.trim() && !hits.length) pick(q.trim())
          if (e.key === 'Enter' && hits.length) pick(hits[0].name)
        }}
      />
      {open && !value && (q.trim() ? (hits.length > 0 || allowNew) : false) && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-rule bg-card shadow-elevated max-h-52 overflow-y-auto">
          {hits.map((v) => (
            <button key={v.name} type="button" onClick={() => pick(v.name)}
              className="w-full text-left px-3 py-1.5 text-sm text-ink-muted hover:bg-elev">
              {v.name}
              <span className="text-[11px] text-ink-faint"> · {v.invoices} invoice{v.invoices === 1 ? '' : 's'}{v.w9_on_file ? ' · W9' : ''}</span>
            </button>
          ))}
          {allowNew && q.trim() && !hits.some((v) => v.name.toLowerCase() === q.trim().toLowerCase()) && (
            <button type="button" onClick={() => pick(q.trim())}
              className="w-full text-left px-3 py-1.5 text-sm text-brand-ink hover:bg-elev border-t border-divider">
              Use “{q.trim()}” — a name no invoice is filed under yet
            </button>
          )}
        </div>
      )}
    </div>
  )
}

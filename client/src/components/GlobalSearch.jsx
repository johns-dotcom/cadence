import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Music, Disc3, FileText, TrendingUp, CornerDownLeft } from 'lucide-react'
import api from '../api'

// Workspace-wide search palette. Opens on Cmd/Ctrl+K (wired in Layout), queries
// /api/search (which is label-scoped server-side), and navigates on select.
const GROUPS = [
  { key: 'releases',  label: 'Releases',  icon: Music,      to: r => `/releases/${r.id}`, primary: r => r.project_name, secondary: r => r.artist_name },
  { key: 'artists',   label: 'Artists',   icon: Disc3,      to: () => '/artists',         primary: r => r.name,         secondary: r => r.genre },
  { key: 'contracts', label: 'Contracts', icon: FileText,   to: () => '/contracts',       primary: r => r.type,         secondary: r => r.artist_name },
  { key: 'deals',     label: 'Deals',     icon: TrendingUp, to: () => '/deals',           primary: r => r.artist_name,  secondary: r => r.stage },
]

export default function GlobalSearch({ open, onClose }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState({ releases: [], artists: [], contracts: [], deals: [] })
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  // Flatten results into an ordered list for keyboard navigation.
  const flat = []
  for (const g of GROUPS) for (const row of results[g.key] || []) flat.push({ g, row })

  useEffect(() => {
    if (open) {
      setQ(''); setResults({ releases: [], artists: [], contracts: [], deals: [] }); setActive(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // Debounced query.
  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (term.length < 2) { setResults({ releases: [], artists: [], contracts: [], deals: [] }); setLoading(false); return }
    setLoading(true)
    const t = setTimeout(() => {
      api.get('/search', { params: { q: term } })
        .then(r => { setResults(r.data.data); setActive(0) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 220)
    return () => clearTimeout(t)
  }, [q, open])

  const go = useCallback((item) => {
    if (!item) return
    navigate(item.g.to(item.row))
    onClose()
  }, [navigate, onClose])

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[active]) }
  }

  if (!open) return null

  let runningIndex = -1
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-overlay" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-card rounded-2xl border border-rule shadow-modal overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-divider">
          <Search size={18} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search releases, artists, contracts, deals…"
            className="flex-1 py-3.5 bg-transparent text-sm text-ink placeholder-gray-400 focus:outline-none"
          />
          <kbd className="text-[10px] text-gray-400 border border-rule rounded px-1.5 py-0.5">esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-2">
          {loading && <p className="px-4 py-6 text-sm text-gray-400 text-center">Searching…</p>}
          {!loading && q.trim().length >= 2 && flat.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No results for “{q.trim()}”.</p>
          )}
          {!loading && q.trim().length < 2 && (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">Type at least 2 characters to search.</p>
          )}
          {!loading && GROUPS.map(g => {
            const rows = results[g.key] || []
            if (!rows.length) return null
            const Icon = g.icon
            return (
              <div key={g.key} className="mb-1">
                <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">{g.label}</p>
                {rows.map(row => {
                  runningIndex += 1
                  const idx = runningIndex
                  const isActive = idx === active
                  return (
                    <button
                      key={`${g.key}-${row.id}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go({ g, row })}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${isActive ? 'bg-brand-500/10' : 'hover:bg-gray-50'}`}
                    >
                      <Icon size={15} className={isActive ? 'text-brand-600' : 'text-gray-400'} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-ink truncate">{g.primary(row) || '—'}</span>
                        {g.secondary(row) && <span className="block text-[11px] text-gray-400 truncate">{g.secondary(row)}</span>}
                      </span>
                      {isActive && <CornerDownLeft size={13} className="text-gray-400 flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

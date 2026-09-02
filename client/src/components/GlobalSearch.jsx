import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Music, Disc3, FileText, TrendingUp, CornerDownLeft,
  Building2, Receipt, CornerDownRight, Clock, X,
} from 'lucide-react'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { buildNavGroups } from '../constants/navConfig'
import { searchPages } from '../lib/pageSearch'
import { formatDate } from '../utils/dates'

// Workspace-wide search palette. Opens on ⌘K or `/` (wired in Layout).
//
// Two halves that deliberately do NOT wait for each other:
//   · PAGES are matched locally against the nav vocabulary already in the
//     bundle — label, path and each item's `synonyms` — and render on the first
//     keystroke. Before this existed the palette searched four entity types,
//     none of which are what people actually reach for, and could not find a
//     page at all.
//   · everything else comes from /api/search (label-scoped server-side).
// Because pages render during the server flight, a query like "vend" never
// flashes "No results" on its way to an answer.
const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

// Group order is fixed: what you are most likely to want, first.
const GROUPS = [
  {
    key: 'pages', label: 'Pages', icon: CornerDownRight,
    to: r => r.path,
    row: r => ({ primary: r.label, secondary: r.path }),
  },
  {
    key: 'vendors', label: 'Vendors', icon: Building2,
    // The vendor directory is keyed by payee NAME, not an id, and /vendors
    // already reads `?vendor=` to open a drawer — so this lands on the record,
    // not on the list with the work still to do.
    to: r => `/vendors?vendor=${encodeURIComponent(r.payee)}`,
    keyOf: r => r.payee,
    row: r => ({
      primary: r.payee,
      secondary: `${r.invoice_count} invoice${r.invoice_count === 1 ? '' : 's'}`,
      meta: money(r.total_spent),
    }),
  },
  {
    key: 'entries', label: 'Ledger', icon: Receipt,
    to: r => `/ledger?focus=${r.id}`,
    row: r => ({
      primary: [r.payee, r.invoice_number && `#${r.invoice_number}`].filter(Boolean).join(' · '),
      secondary: [r.artist, r.category].filter(Boolean).join(' · '),
      meta: money(r.amount, r.currency),
    }),
  },
  {
    key: 'releases', label: 'Releases', icon: Music,
    to: r => `/releases/${r.id}`,
    row: r => ({
      primary: r.project_name,
      secondary: r.artist_name,
      chip: r.release_type,
      meta: r.release_date ? formatDate(r.release_date) : '',
    }),
  },
  {
    key: 'artists', label: 'Artists', icon: Disc3,
    // The profile route exists; sending an artist hit to the LIST made the
    // result a navigation, not an answer.
    to: r => `/artists/${r.id}`,
    row: r => ({
      primary: r.name,
      secondary: r.genre,
      avatar: r.name,
      meta: r.total_releases ? `${r.total_releases} release${r.total_releases === 1 ? '' : 's'}` : '',
    }),
  },
  {
    key: 'contracts', label: 'Contracts', icon: FileText,
    to: () => '/contracts',
    row: r => ({ primary: [r.artist_name, r.type].filter(Boolean).join(' · '), secondary: r.type, status: r.status }),
  },
  {
    key: 'deals', label: 'Deals', icon: TrendingUp,
    to: () => '/deals',
    row: r => ({ primary: r.artist_name, secondary: r.genre, meta: r.stage }),
  },
]

const PILLS = [{ key: 'all', label: 'All' }, ...GROUPS.map(g => ({ key: g.key, label: g.label }))]
const EMPTY = { releases: [], artists: [], contracts: [], deals: [], vendors: [], entries: [] }

// ── Recent selections ────────────────────────────────────────────────────────
// The last 8 things opened from the palette, so re-reaching for the vendor you
// looked at ten minutes ago costs nothing. Stored per browser (there is no
// server-side notion of "what I searched"), typed by group so the row renders
// the same way it did in the results, and deduped on the same identity the
// result rows use.
const RECENT_KEY = 'cadence_search_recent'
const recentId = (groupKey, row) => `${groupKey}:${row.id ?? row.path ?? row.payee ?? row.label}`
function loadRecents() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 8) : [] }
  catch { return [] }
}
function pushRecent(groupKey, row) {
  const entry = { g: groupKey, row, _id: recentId(groupKey, row) }
  const next = [entry, ...loadRecents().filter(r => r._id !== entry._id)].slice(0, 8)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* quota / private mode */ }
  return next
}

export default function GlobalSearch({ open, onClose }) {
  const { user, canView } = useAuth()
  const [q, setQ] = useState('')
  const [results, setResults] = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [pill, setPill] = useState('all')
  const [recents, setRecents] = useState(loadRecents)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)

  // The nav definition IS the page vocabulary — one source, so a nav item added
  // tomorrow is searchable tomorrow without a second list to remember.
  const pages = useMemo(
    () => buildNavGroups({ isAdmin, isApprover }).flatMap(g => g.items),
    [isAdmin, isApprover],
  )

  const term = q.trim()
  const pageHits = useMemo(() => searchPages(pages, term, canView), [pages, term, canView])

  const grouped = useMemo(() => {
    const out = {}
    for (const g of GROUPS) {
      if (pill !== 'all' && pill !== g.key) { out[g.key] = []; continue }
      out[g.key] = g.key === 'pages' ? pageHits : (results[g.key] || [])
    }
    return out
  }, [results, pageHits, pill])

  // Flat ordered list for keyboard navigation.
  const flat = []
  for (const g of GROUPS) for (const row of grouped[g.key] || []) flat.push({ g, row })

  useEffect(() => {
    if (open) {
      setQ(''); setResults(EMPTY); setActive(0); setPill('all'); setRecents(loadRecents())
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // Debounced server half. The page half above is synchronous.
  useEffect(() => {
    if (!open) return
    if (term.length < 2) { setResults(EMPTY); setLoading(false); return }
    setLoading(true)
    const t = setTimeout(() => {
      api.get('/search', { params: { q: term } })
        .then(r => { setResults({ ...EMPTY, ...r.data.data }); setActive(0) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 220)
    return () => clearTimeout(t)
  }, [term, open])

  const go = useCallback((item) => {
    if (!item) return
    setRecents(pushRecent(item.g.key, item.row))
    navigate(item.g.to(item.row))
    onClose()
  }, [navigate, onClose])

  const goRecent = (r) => {
    const g = GROUPS.find(x => x.key === r.g)
    if (!g) return
    setRecents(pushRecent(r.g, r.row))
    navigate(g.to(r.row))
    onClose()
  }

  const clearRecents = () => { try { localStorage.removeItem(RECENT_KEY) } catch {} ; setRecents([]) }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[active]) }
  }

  if (!open) return null

  const showRecents = term.length < 2 && recents.length > 0
  let runningIndex = -1

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-overlay backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-card rounded-2xl border border-rule shadow-modal overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        <div className="flex items-center gap-3 px-4 border-b border-divider">
          <Search size={18} className="text-ink-faint flex-shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, vendors, invoices, releases…"
            className="flex-1 py-3.5 bg-transparent text-sm text-ink placeholder-ink-faint focus:outline-none"
          />
          <kbd className="text-[10px] text-ink-faint border border-rule rounded px-1.5 py-0.5">esc</kbd>
        </div>

        {/* Category pills — filter what's already fetched, no re-query. */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-divider overflow-x-auto">
          {PILLS.map(p => (
            <button
              key={p.key}
              onClick={() => { setPill(p.key); setActive(0) }}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                pill === p.key ? 'bg-brand-500/15 text-brand-ink' : 'text-ink-muted hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-2">
          {showRecents && (
            <div className="mb-1">
              <div className="flex items-center justify-between px-4 pt-2 pb-1">
                <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest">Recent</p>
                <button onClick={clearRecents} className="text-[10px] font-semibold text-ink-faint hover:text-danger inline-flex items-center gap-1">
                  <X size={10} /> Clear
                </button>
              </div>
              {recents.map(r => {
                const g = GROUPS.find(x => x.key === r.g)
                if (!g) return null
                const view = g.row(r.row)
                return (
                  <button key={r._id} onClick={() => goRecent(r)}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 transition-colors">
                    <Clock size={14} className="text-ink-faint flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-ink truncate">{view.primary || '—'}</span>
                      <span className="block text-[11px] text-ink-faint truncate">{g.label}{view.secondary ? ` · ${view.secondary}` : ''}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Loading replaces nothing — page hits already on screen stay. */}
          {loading && (
            <p className="px-4 py-3 text-xs text-ink-faint text-center inline-flex items-center gap-2 w-full justify-center">
              <span className="w-3 h-3 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
              Searching…
            </p>
          )}
          {!loading && term.length >= 2 && flat.length === 0 && (
            <p className="px-4 py-6 text-sm text-ink-muted text-center">No results for “{term}”.</p>
          )}
          {term.length < 2 && !showRecents && (
            <p className="px-4 py-6 text-sm text-ink-muted text-center">Search releases, artists, vendors, invoices and pages.</p>
          )}

          {GROUPS.map(g => {
            const rows = grouped[g.key] || []
            if (!rows.length) return null
            const Icon = g.icon
            return (
              <div key={g.key} className="mb-1">
                <p className="px-4 pt-2 pb-1 text-[10px] font-bold text-ink-faint uppercase tracking-wider flex items-center gap-1.5">
                  <Icon size={11} /> {g.label}
                  <span className="font-semibold opacity-70">({rows.length})</span>
                </p>
                {rows.map(row => {
                  runningIndex += 1
                  const idx = runningIndex
                  const isActive = idx === active
                  const view = g.row(row)
                  return (
                    <button
                      key={`${g.key}-${g.keyOf ? g.keyOf(row) : (row.id ?? row.path)}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go({ g, row })}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${isActive ? 'bg-brand-500/10' : 'hover:bg-gray-50'}`}
                    >
                      {view.avatar ? (
                        <span className="w-6 h-6 rounded-full bg-brand-500/15 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-brand-ink">
                          {String(view.avatar).charAt(0).toUpperCase()}
                        </span>
                      ) : (
                        <Icon size={15} className={`flex-shrink-0 ${isActive ? 'text-brand-ink' : 'text-ink-faint'}`} />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="block text-sm text-ink truncate">{view.primary || '—'}</span>
                          {view.chip && (
                            <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-ink-muted flex-shrink-0">{view.chip}</span>
                          )}
                          {view.status && (
                            <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 ${
                              view.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-ink-muted'
                            }`}>{view.status}</span>
                          )}
                        </span>
                        {view.secondary && <span className="block text-[11px] text-ink-faint truncate">{view.secondary}</span>}
                      </span>
                      {view.meta && <span className="text-[11px] text-ink-faint tabular-nums flex-shrink-0">{view.meta}</span>}
                      {isActive && <CornerDownLeft size={13} className="text-ink-faint flex-shrink-0" />}
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

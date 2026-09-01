// Data Quality — the hub for "something here is wrong, or something here is
// missing".
//
// Two rules the layout exists to serve:
//
//  1. TWO FIGURES, NEVER ONE. "N potential issues" conflated things that are
//     WRONG (duplicated, contradictory, flagged by a person — someone has to
//     decide) with fields that are merely EMPTY (bulk data entry). The header
//     splits them, and every derived number honours the same split, so the
//     subtitle can never disagree with the rail or the body.
//
//  2. THE SERVER OWNS THE CHECK LIST. Categories arrive with their own group,
//     nature, severity and description; an unrecognised kind renders through
//     the fallback rather than vanishing. A new check added in
//     server/routes/flags.js shows up here with no client change.
//
// Everything destructive states what moves before it runs, and every fix is
// reversible for five seconds — see PENDING_MS.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Ban, Check, ChevronRight, Copy, ExternalLink, Eye, EyeOff, FileText,
  GitMerge, Pencil, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, X, Archive,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import SplitModal from '../components/SplitModal'
import { ConfirmDialog } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../utils/dates'

// Severity → token. `danger` / `warning` / `info` are var-backed in both
// themes; the raw red-100/orange-100 chips this page used to draw went
// near-white in dark and took their own text with them.
const SEV = {
  high: { dot: 'bg-danger', text: 'text-danger', label: 'High' },
  medium: { dot: 'bg-warning', text: 'text-warning', label: 'Medium' },
  low: { dot: 'bg-info', text: 'text-info', label: 'Low' },
}
const sevOf = (s) => SEV[s] || SEV.medium

const GROUP_ORDER = ['Money', 'Ledger', 'Catalog', 'Artists']
// An unknown kind is a PROBLEM in the Ledger group and still renders. The
// alternative — a hard-coded tab list — silently drops any check the server
// grows later, which is the failure this rule exists to prevent.
const classify = (c) => ({ group: GROUP_ORDER.includes(c.group) ? c.group : 'Ledger', nature: c.nature === 'completeness' ? 'completeness' : 'problem' })
const isProblem = (c) => classify(c).nature === 'problem'

// Short rail labels. The full label stays on the section header — "Potential
// Duplicate Releases" in a 224px rail is just an ellipsis.
const SHORT_LABEL = {
  duplicate_invoices: 'Duplicate invoices', duplicate_vendors: 'Duplicate vendors',
  vendor_w9_mismatch: 'W9 name ≠ payee', flagged_expenses: 'Flagged expenses',
  flagged_transactions: 'Flagged transactions', artist_likely_typo: 'Likely typo',
  artist_song_mismatch: 'Artist ↔ song', artist_unknown: 'Unknown artist',
  artist_multi_name: 'Multiple artists', artist_placeholder: 'Placeholder artist',
  artist_multi_normalize: 'Multi-artist rows', artist_variants: 'Spelling variants',
  artist_missing: 'Missing artist', ledger_missing_song: 'Missing song',
  ledger_missing_socials: 'Missing socials', duplicate_releases: 'Duplicate releases',
  releases_missing_genre: 'Genre', releases_missing_upc: 'UPC',
  releases_missing_isrc: 'ISRC', releases_missing_spotify: 'Spotify link',
  duplicate_artists: 'Duplicate artists', artists_missing_genre: 'Genre',
  artists_missing_spotify: 'Spotify link',
}
const shortLabel = (c) => SHORT_LABEL[c.kind] || c.label || c.kind

const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const usdRound = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
const PENDING_MS = 5000

// Depth-limited primitive collector for the section filter. Identifier keys are
// skipped: without that, "3" matches nearly every row through its id and the
// filter is useless.
const SKIP_KEYS = new Set(['id', 'group_key', 'flag_key', 'source_key', 'kind', 'severity', 'nature', 'artist_id', 'release_id', 'entry_id', 'statement_id', 'parent_id', 'file_entry_id'])
function searchableValues(node, depth = 0, out = []) {
  if (node == null || depth > 4) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(node); return out }
  if (Array.isArray(node)) { for (const v of node) searchableValues(v, depth + 1, out); return out }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (SKIP_KEYS.has(k) || k.endsWith('_id')) continue
      searchableValues(v, depth + 1, out)
    }
  }
  return out
}
const matchesQuery = (q, values) => {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return values.some(v => String(v).toLowerCase().includes(needle))
}

export default function DataQuality() {
  const { toast } = useToast()
  const { user } = useAuth()
  const isAdmin = ['Admin', 'Superadmin'].includes(user?.role)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(false)
  const [showLow, setShowLow] = useState(false)
  const [showDismissed, setShowDismissed] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [confirmState, setConfirmState] = useState(null) // { title, message, onConfirm }
  const [splitEntry, setSplitEntry] = useState(null)

  // Active section lives in the URL so a section is bookmarkable, shareable
  // and survives a reload. Back/forward move between sections.
  const [params, setParams] = useSearchParams()
  const activeTab = params.get('tab') || 'overview'
  const setTab = useCallback((kind) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      if (!kind || kind === 'overview') next.delete('tab'); else next.set('tab', kind)
      return next
    }, { replace: true })
  }, [setParams])

  const load = useCallback((withSpinner = true) => {
    if (withSpinner) setLoading(true); else setRefreshing(true)
    api.get('/flags', { params: showDismissed ? { include_dismissed: 1 } : {} })
      .then(r => { setData(r.data.data); setError(false) })
      .catch(() => setError(true))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }, [showDismissed])
  // The skeleton is for the FIRST load only. Toggling show-dismissed refetches,
  // and blanking the whole page to redraw the same sections reads as a crash.
  const firstLoad = useRef(true)
  useEffect(() => { load(firstLoad.current); firstLoad.current = false }, [load])

  const categories = useMemo(() => data?.categories || [], [data])
  // Low-severity categories are hidden by default, and the SAME filtered list
  // feeds the headline figures, the rail and the body — otherwise the header
  // announces a number the page below it does not show.
  const visible = useMemo(() => showLow ? categories : categories.filter(c => c.severity !== 'low'), [categories, showLow])
  const totalFlags = visible.reduce((s, c) => s + (c.count || 0), 0)
  const problemCount = visible.filter(isProblem).reduce((s, c) => s + (c.count || 0), 0)
  const incompleteCount = totalFlags - problemCount
  // Lookup runs against the FULL list so a deep link to a low-severity section
  // still resolves with the toggle off.
  const activeCategory = useMemo(() => categories.find(c => c.kind === activeTab) || null, [categories, activeTab])

  const navGroups = useMemo(() => GROUP_ORDER.map(name => ({
    name,
    cats: visible.filter(c => classify(c).group === name)
      .sort((a, b) => (isProblem(b) - isProblem(a)) || ((b.count || 0) - (a.count || 0))),
  })).filter(g => g.cats.length), [visible])

  // ── Section filter ────────────────────────────────────────────────────────
  const [q, setQ] = useState('')
  useEffect(() => { setQ('') }, [activeTab])
  const filtered = useMemo(() => {
    if (!activeCategory || !q.trim()) return activeCategory
    const next = { ...activeCategory }
    if (Array.isArray(next.items)) next.items = next.items.filter(i => matchesQuery(q, searchableValues(i)))
    if (Array.isArray(next.groups)) next.groups = next.groups.filter(g => matchesQuery(q, searchableValues(g)))
    return next
  }, [activeCategory, q])
  const shown = filtered ? (filtered.items?.length ?? filtered.groups?.length ?? 0) : 0
  const total = activeCategory ? (activeCategory.items?.length ?? activeCategory.groups?.length ?? 0) : 0

  // ── Dismiss / restore ─────────────────────────────────────────────────────
  // `summary` is stamped at dismiss time. The key is an id signature and the
  // rows behind it can be merged away later, so a dismissed entry cannot be
  // re-hydrated — the sentence has to be captured now or lost.
  const dismiss = async (flag_key, kind, summary) => {
    try { await api.post('/flags/dismiss', { flag_key, kind, summary }); load(false) }
    catch { toast('Dismiss failed', 'error') }
  }
  const restore = async (flag_key) => {
    try { await api.post('/flags/restore', { flag_key }); load(false) }
    catch { toast('Restore failed', 'error') }
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  // ONE confirm, ONE request, ONE reload. The previous shape fired a confirm
  // and an unawaited POST per non-survivor, so a group of four stacked three
  // dialogs over three concurrent merge transactions racing each other.
  const ask = (title, message, onConfirm) => setConfirmState({ title, message, onConfirm })
  const runMerge = async (path, body, label) => {
    setConfirmState(null)
    try { await api.post(path, body); toast(label); load(false) }
    catch (err) { toast(err.response?.data?.error || 'Merge failed', 'error') }
  }
  const archiveRelease = async (id, name) => {
    setConfirmState(null)
    try { await api.post('/flags/archive-release', { id }); toast(`Archived "${name}"`); load(false) }
    catch (err) { toast(err.response?.data?.error || 'Archive failed', 'error') }
  }
  const renameArtist = async (id, name) => {
    try { await api.post('/flags/rename-artist', { id, name }); toast('Renamed'); load(false); return true }
    catch (err) { toast(err.response?.data?.error || 'Rename failed', 'error'); return false }
  }

  // ── Ledger fixes: apply → 5s reversible fade → gone ───────────────────────
  // A fix that vanishes instantly gives no chance to notice it was wrong, and
  // re-finding the row means re-running the scan. The row stays visible,
  // struck through, with Undo, until the timer strips it.
  const [pending, setPending] = useState({}) // 'id:kind' → { field, oldValue, timerId }
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => () => { Object.values(pendingRef.current).forEach(p => clearTimeout(p.timerId)) }, [])

  const stripRow = (kind, id) => setData(prev => prev && ({
    ...prev,
    categories: prev.categories.map(c => c.kind !== kind ? c
      : { ...c, items: (c.items || []).filter(i => i.id !== id), count: Math.max(0, (c.count || 0) - 1) }),
  }))
  const patchRow = (kind, id, patch) => setData(prev => prev && ({
    ...prev,
    categories: prev.categories.map(c => c.kind !== kind ? c
      : { ...c, items: (c.items || []).map(i => i.id === id ? { ...i, ...patch } : i) }),
  }))
  const queuePending = (kind, id, field, oldValue) => {
    const key = `${id}:${kind}`
    const timerId = setTimeout(() => {
      stripRow(kind, id)
      setPending(p => { const n = { ...p }; delete n[key]; return n })
    }, PENDING_MS)
    setPending(p => {
      if (p[key]?.timerId) clearTimeout(p[key].timerId)
      return { ...p, [key]: { field, oldValue, timerId } }
    })
  }
  const applyFieldFix = async (kind, row, field, value, flagKey) => {
    setBusyId(row.id)
    try {
      await api.patch(`/ledger/entries/${row.id}`, { [field]: value })
      await api.post('/flags/dismiss', { flag_key: flagKey, kind, summary: `${row.payee || 'Entry'} #${row.id} — ${field} set to "${value || '(blank)'}"` }).catch(() => {})
      patchRow(kind, row.id, { [field]: value })
      queuePending(kind, row.id, field, row[field] || '')
    } catch (err) { toast(err.response?.data?.error || 'Fix failed', 'error') }
    finally { setBusyId(null) }
  }
  const undoFix = async (kind, row) => {
    const key = `${row.id}:${kind}`
    const p = pending[key]
    if (!p) return
    clearTimeout(p.timerId)
    setBusyId(row.id)
    try {
      // PATCH refuses a bare '' on some fields, so an empty restore sends null.
      await api.patch(`/ledger/entries/${row.id}`, { [p.field]: p.oldValue || null })
      await api.post('/flags/restore', { flag_key: row.flag_key }).catch(() => {})
      patchRow(kind, row.id, { [p.field]: p.oldValue || '' })
    } catch (err) { toast(err.response?.data?.error || 'Undo failed', 'error') }
    setPending(prev => { const n = { ...prev }; delete n[key]; return n })
    setBusyId(null)
  }
  // Clearing a placeholder is NOT a mode of applyFieldFix: that one refuses an
  // empty value, and rightly so — for every other flag here blank is the
  // problem. On a placeholder row blank is the ANSWER. Salary, Rent and Legal
  // spend genuinely belongs to no artist, and "n/a" states an attribution no
  // report agrees with.
  const clearArtist = (kind, row) => ask(
    'Clear the artist field?',
    `The row keeps its category and amount and simply stops naming an artist — which is what the P&L and Spend by Artist already assume. "${row.artist}" is removed.`,
    async () => { setConfirmState(null); await applyFieldFix(kind, row, 'artist', '', row.flag_key) },
  )

  // ── Normalization ─────────────────────────────────────────────────────────
  const applyNormalization = async (pattern, base) => {
    try {
      const { data: r } = await api.post('/flags/normalization', { pattern, base_artist: base })
      toast(`Renamed ${r.data.expenses + r.data.deals} row${r.data.expenses + r.data.deals === 1 ? '' : 's'}`)
      load(false)
      return { ok: true }
    } catch (err) { return { ok: false, error: err.response?.data?.error || 'Apply failed' } }
  }
  const deleteRule = async (id) => {
    try { await api.delete(`/flags/normalization/${id}`); load(false) }
    catch { toast('Failed', 'error') }
  }

  if (loading) return <div className="space-y-6"><Skeleton.PageHeader /><Skeleton.Block h="h-12" /><Skeleton.Block h="h-64" /></div>
  if (error || !data) {
    return (
      <div>
        <PageHeader title="Data Quality" />
        <div className="card p-10 text-center">
          <AlertTriangle size={26} className="text-warning mx-auto mb-3" />
          <p className="text-sm text-ink-muted">The data-quality scan could not be loaded.</p>
          <button onClick={() => load()} className="btn-secondary mt-3 inline-flex items-center gap-1.5"><RefreshCw size={13} /> Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Quality"
        subtitle={totalFlags === 0 ? 'Nothing flagged.' : [
          problemCount ? `${problemCount.toLocaleString()} need${problemCount === 1 ? 's' : ''} a decision` : null,
          incompleteCount ? `${incompleteCount.toLocaleString()} field${incompleteCount === 1 ? '' : 's'} incomplete` : null,
        ].filter(Boolean).join(' · ')}
        action={
          <button onClick={() => load(false)} disabled={refreshing} title="Re-scan for flags"
            className="p-1.5 text-ink-faint hover:text-brand-ink rounded-lg hover:bg-brand-500/10 transition-colors disabled:opacity-40">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        }
      />

      {/* Narrow screens get one grouped select. The alternative — a horizontal
          scroller of 20+ tabs inside a vertical page — shows five at a time and
          is close to undiscoverable. */}
      <div className="lg:hidden">
        <select value={activeTab} onChange={e => setTab(e.target.value)} className="input">
          <option value="overview">Overview{totalFlags ? ` · ${totalFlags}` : ''}</option>
          {navGroups.map(g => (
            <optgroup key={g.name} label={g.name}>
              {g.cats.map(c => <option key={c.kind} value={c.kind}>{shortLabel(c)} · {c.count}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="lg:flex lg:items-start lg:gap-6">
        <FlagsNav groups={navGroups} activeTab={activeTab} onPick={setTab} totalFlags={totalFlags} />

        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex items-center gap-4">
            <button onClick={() => setShowLow(v => !v)} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted hover:text-ink">
              {showLow ? <EyeOff size={12} /> : <Eye size={12} />}{showLow ? 'Hide low-severity' : 'Show low-severity'}
            </button>
            <button onClick={() => setShowDismissed(v => !v)} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted hover:text-ink">
              {showDismissed ? <EyeOff size={12} /> : <Eye size={12} />}{showDismissed ? 'Hide dismissed' : 'Show dismissed'}
            </button>
          </div>

          {showDismissed && <DismissedList rows={data.dismissed || []} onRestore={restore} />}

          {activeTab === 'overview' && <Overview categories={visible} totalFlags={totalFlags} onPick={setTab} />}

          {activeCategory && (
            <>
              <div className="border-b border-divider pb-3">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${sevOf(activeCategory.severity).dot}`} />
                  <h2 className="text-[15px] font-extrabold text-ink">{activeCategory.label}</h2>
                  <span className="text-xs text-ink-faint tabular-nums">{(activeCategory.count || 0).toLocaleString()}</span>
                  <button onClick={() => setTab('overview')} className="ml-auto text-[11px] font-semibold text-ink-muted hover:text-ink">← All flags</button>
                </div>
                {activeCategory.description && <p className="text-xs text-ink-muted mt-1.5 max-w-3xl">{activeCategory.description}</p>}
              </div>

              {/* The filter is gated on the ORIGINAL count, so it survives zero
                  matches — otherwise the input disappears with the rows and
                  there is no way to clear the query that hid them. */}
              {total > 0 && (
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Filter ${activeCategory.label.toLowerCase()}…`}
                      className="input !pl-8 !py-1.5 text-xs !w-72" />
                  </div>
                  {q.trim() && <span className="text-[11px] text-ink-muted tabular-nums">{shown} of {total}</span>}
                </div>
              )}

              {total === 0 && (
                <div className="card p-12 text-center">
                  <ShieldCheck size={28} className="text-success mx-auto mb-3" />
                  <p className="text-sm text-ink-muted">Nothing flagged in this category.</p>
                </div>
              )}
              {total > 0 && shown === 0 && (
                <div className="card p-10 text-center">
                  <p className="text-sm text-ink-muted">Nothing in this section matches “{q}”.</p>
                  <button onClick={() => setQ('')} className="mt-2 text-xs font-bold text-brand-ink hover:underline">Clear filter</button>
                </div>
              )}
              {total > 0 && shown > 0 && (
                <CategoryBody
                  cat={filtered} isAdmin={isAdmin} roster={data.roster || []} rules={data.normalization_map || []}
                  busyId={busyId} pending={pending}
                  onDismiss={dismiss} onRestore={restore} ask={ask} runMerge={runMerge}
                  onArchiveRelease={archiveRelease} onRenameArtist={renameArtist}
                  onApplyFix={applyFieldFix} onUndoFix={undoFix} onClearArtist={clearArtist}
                  onSplit={setSplitEntry} onApplyNormalization={applyNormalization} onDeleteRule={deleteRule}
                />
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmState} onClose={() => setConfirmState(null)}
        onConfirm={() => confirmState?.onConfirm?.()}
        title={confirmState?.title} message={confirmState?.message}
        confirmLabel="Continue" variant="danger"
      />
      {splitEntry && (
        <SplitModal entry={splitEntry} artistNames={(data.roster || []).map(a => a.name)} toast={toast}
          onClose={() => setSplitEntry(null)} onDone={() => { setSplitEntry(null); load(false) }} />
      )}
    </div>
  )
}

// ── Rail ────────────────────────────────────────────────────────────────────
function FlagsNav({ groups, activeTab, onPick, totalFlags }) {
  return (
    <nav className="hidden lg:block w-56 shrink-0 sticky top-4 self-start">
      <button onClick={() => onPick('overview')}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-bold transition-colors ${
          activeTab === 'overview' ? 'bg-brand-500/15 text-brand-ink' : 'text-ink hover:bg-brand-500/10'}`}>
        Overview
        {totalFlags > 0 && <span className="text-[11px] font-semibold text-ink-muted tabular-nums">{totalFlags.toLocaleString()}</span>}
      </button>
      {groups.map(g => (
        <div key={g.name} className="mt-4">
          <p className="px-3 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-ink-muted">{g.name}</p>
          {g.cats.map(c => {
            const active = activeTab === c.kind
            const empty = !c.count
            return (
              <button key={c.kind} onClick={() => onPick(c.kind)} disabled={empty} title={c.label}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] transition-colors ${
                  active ? 'bg-brand-500/15 text-brand-ink font-bold'
                    : empty ? 'text-ink-faint cursor-default' : 'text-ink-muted hover:bg-brand-500/10 hover:text-ink'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sevOf(c.severity).dot} ${empty ? 'opacity-30' : ''}`} />
                <span className="truncate flex-1 text-left">{shortLabel(c)}</span>
                <span className={`text-[11px] tabular-nums shrink-0 ${empty ? 'text-ink-faint' : 'text-ink-muted'}`}>{c.count}</span>
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

// ── Overview ────────────────────────────────────────────────────────────────
function Overview({ categories, totalFlags, onPick }) {
  const problems = categories.filter(c => isProblem(c) && c.count > 0)
  const incomplete = categories.filter(c => !isProblem(c) && c.count > 0)
  if (totalFlags === 0) {
    return (
      <div className="card p-12 text-center">
        <ShieldCheck size={28} className="text-success mx-auto mb-3" />
        <p className="text-sm text-ink-muted">No flagged data right now.</p>
        <p className="text-xs text-ink-faint mt-1 max-w-xl mx-auto">We check the catalog (duplicate releases and artists, missing genre / UPC / ISRC / Spotify links) and the ledger (duplicate vendors and invoices, artist-column problems, rows flagged by hand).</p>
      </div>
    )
  }
  const ordered = GROUP_ORDER.flatMap(name => problems.filter(c => classify(c).group === name).sort((a, b) => b.count - a.count))
  return (
    <div className="space-y-8">
      {ordered.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-[13px] font-extrabold text-ink">Needs a decision</h2>
            <span className="text-[11px] text-ink-muted">{ordered.reduce((s, c) => s + c.count, 0).toLocaleString()} across {ordered.length} check{ordered.length === 1 ? '' : 's'}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {ordered.map(c => (
              <button key={c.kind} onClick={() => onPick(c.kind)} className="card p-4 text-left transition-all hover:border-brand-400 hover:shadow-sm cursor-pointer group">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${sevOf(c.severity).dot}`} />
                  <p className="text-xs font-bold text-ink truncate flex-1">{c.label}</p>
                  <ChevronRight size={14} className="text-ink-faint group-hover:text-brand-ink shrink-0" />
                </div>
                <p className="text-2xl font-black text-ink mt-2 tabular-nums">{c.count.toLocaleString()}</p>
                <p className="text-[11px] text-ink-muted mt-1 line-clamp-2">{c.description}</p>
              </button>
            ))}
          </div>
        </section>
      )}
      {incomplete.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-[13px] font-extrabold text-ink">Incomplete fields</h2>
            <span className="text-[11px] text-ink-muted">{incomplete.reduce((s, c) => s + c.count, 0).toLocaleString()} to fill in</span>
          </div>
          <div className="card divide-y divide-divider">
            {[...incomplete].sort((a, b) => b.count - a.count).map(c => {
              // of_total comes from the server. Without it there is no honest
              // denominator, so the count stands alone rather than a bar drawn
              // against a guess.
              const of = Number(c.of_total) || 0
              const pct = of > 0 ? Math.max(0, Math.min(100, Math.round(((of - c.count) / of) * 100))) : null
              return (
                <button key={c.kind} onClick={() => onPick(c.kind)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-brand-500/10 transition-colors group">
                  <span className="text-[12.5px] text-ink w-48 shrink-0 truncate">{c.label}</span>
                  {pct == null ? <span className="flex-1 text-[11px] text-ink-faint">no total available</span> : (
                    <span className="flex-1 flex items-center gap-2 min-w-0">
                      <span className="flex-1 h-1.5 rounded-full bg-elev overflow-hidden min-w-0">
                        <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="text-[11px] text-ink-muted tabular-nums w-9 text-right">{pct}%</span>
                    </span>
                  )}
                  <span className="text-xs text-ink-muted tabular-nums shrink-0 w-28 text-right">{c.count.toLocaleString()} missing</span>
                  <ChevronRight size={14} className="text-ink-faint group-hover:text-brand-ink shrink-0" />
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Body switcher ───────────────────────────────────────────────────────────
// Shape first, kind second: anything the server sends as `groups` or `items`
// renders through a generic fallback even when this file has never heard of it.
function CategoryBody(props) {
  const { cat } = props
  switch (cat.kind) {
    case 'duplicate_releases': return <ReleaseDupes {...props} />
    case 'duplicate_artists': return <ArtistDupes {...props} />
    case 'duplicate_vendors': return <VendorDupes {...props} />
    case 'duplicate_invoices': return <InvoiceDupes {...props} />
    case 'vendor_w9_mismatch': return <W9Mismatch {...props} />
    case 'artist_multi_normalize': return <MultiArtistSection {...props} />
    case 'flagged_expenses': return <FlaggedExpenses {...props} />
    case 'flagged_transactions': return <FlaggedTransactions {...props} />
    case 'releases_missing_genre': case 'releases_missing_upc':
    case 'releases_missing_isrc': case 'releases_missing_spotify': return <ReleaseList {...props} />
    case 'artists_missing_genre': case 'artists_missing_spotify': return <ArtistList {...props} />
    default:
      if (Array.isArray(cat.items)) return <LedgerFlagRows {...props} />
      return <GenericGroups {...props} />
  }
}

function GroupShell({ title, subtitle, badge, dismissed, onDismiss, onRestore, children }) {
  return (
    <div className={`card p-4 ${dismissed ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="font-medium text-ink text-sm break-words">{title}</p>
          {subtitle && <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>}
          {badge && <div className="mt-1 flex flex-wrap gap-1">{badge}</div>}
        </div>
        {dismissed
          ? <button onClick={onRestore} className="text-xs font-semibold text-brand-ink hover:underline inline-flex items-center gap-1 shrink-0"><RotateCcw size={12} /> Restore</button>
          : <button onClick={onDismiss} title="Not a problem — hide this group" className="text-ink-faint hover:text-danger shrink-0"><Ban size={15} /></button>}
      </div>
      {children}
    </div>
  )
}
const ReasonChip = ({ children }) => (
  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted bg-elev border border-divider rounded px-1.5 py-0.5">{children}</span>
)
const IdChip = ({ label, value }) => value
  ? <span className="text-[10px] font-mono text-ink-muted bg-elev border border-divider rounded px-1.5 py-0.5">{label} {value}</span>
  : null

// ── Duplicate releases ──────────────────────────────────────────────────────
function ReleaseDupes({ cat, isAdmin, onDismiss, onRestore, ask, runMerge, onArchiveRelease }) {
  return (
    <div className="space-y-3">
      {!isAdmin && <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg p-2">Merging needs admin access — Archive resolves a duplicate without one.</div>}
      {cat.groups.map(g => (
        <ReleaseDupeCard key={g.flag_key} g={g} isAdmin={isAdmin} ask={ask} runMerge={runMerge}
          onArchiveRelease={onArchiveRelease}
          onDismiss={() => onDismiss(g.flag_key, 'duplicate_releases', `Duplicate releases: ${g.releases.map(r => r.project_name).join(' / ')}`)}
          onRestore={() => onRestore(g.flag_key)} />
      ))}
    </div>
  )
}
function ReleaseDupeCard({ g, isAdmin, ask, runMerge, onArchiveRelease, onDismiss, onRestore }) {
  const [keep, setKeep] = useState(g.releases[0]?.id)
  const sources = g.releases.filter(r => r.id !== keep)
  const survivor = g.releases.find(r => r.id === keep)
  return (
    <GroupShell dismissed={g.dismissed} onDismiss={onDismiss} onRestore={onRestore}
      title={g.releases.map(r => r.project_name).join(' · ')}
      subtitle={g.dismissed ? `Dismissed by ${g.dismissed_by || '—'}` : null}
      badge={g.reasons.map(r => <ReasonChip key={r}>{r}</ReasonChip>)}>
      <div className="space-y-2">
        {g.releases.map(r => (
          <div key={r.id} className={`flex items-start gap-3 rounded-lg border p-2.5 ${r.id === keep ? 'border-success/40 bg-success/10' : 'border-divider bg-elev'}`}>
            {r.cover_art_url
              ? <img src={r.cover_art_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
              : <div className="w-10 h-10 rounded bg-card border border-divider shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name={`keep-${g.flag_key}`} checked={r.id === keep} onChange={() => setKeep(r.id)} className="accent-current text-brand-600" />
                  <Link to={`/releases/${r.id}`} className="text-sm font-semibold text-ink hover:text-brand-ink truncate">{r.project_name}</Link>
                </label>
                {r.id === keep && <span className="text-[10px] font-bold uppercase text-success">Keep</span>}
              </div>
              <p className="text-[11px] text-ink-muted mt-0.5">{r.artist_name || 'No artist'} · {formatDate(r.release_date)}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                <IdChip label="UPC" value={r.upc} /><IdChip label="ISRC" value={r.isrc} /><IdChip label="Spotify" value={r.spotify_uri} />
              </div>
            </div>
            {r.id !== keep && isAdmin && (
              <button onClick={() => ask('Archive this release?', `"${r.project_name}" is hidden from the catalog. Nothing is deleted and it can be restored from the release itself.`, () => onArchiveRelease(r.id, r.project_name))}
                title="Archive instead of merging" className="text-ink-faint hover:text-warning shrink-0"><Archive size={14} /></button>
            )}
          </div>
        ))}
      </div>
      {isAdmin && sources.length > 0 && (
        <button
          onClick={() => ask('Merge these releases?',
            `${sources.length} release${sources.length === 1 ? '' : 's'} (${sources.map(s => s.project_name).join(', ')}) fold into "${survivor?.project_name}". The survivor fills its blank fields from them, keeps its own values, absorbs their DSP rows, tasks and linked ledger entries — then they are permanently deleted.`,
            () => runMerge('/flags/merge-releases', { target_id: keep, source_ids: sources.map(s => s.id) }, 'Releases merged'))}
          className="btn-secondary !py-1 text-xs mt-3"><GitMerge size={13} /> Merge {sources.length} into “{survivor?.project_name}”</button>
      )}
    </GroupShell>
  )
}

// ── Duplicate artists ───────────────────────────────────────────────────────
function ArtistDupes({ cat, isAdmin, onDismiss, onRestore, ask, runMerge, onRenameArtist }) {
  return (
    <div className="space-y-3">
      {cat.groups.map(g => (
        <ArtistDupeCard key={g.flag_key} g={g} isAdmin={isAdmin} ask={ask} runMerge={runMerge} onRenameArtist={onRenameArtist}
          onDismiss={() => onDismiss(g.flag_key, 'duplicate_artists', `Duplicate artists: ${g.artists.map(a => a.name).join(' / ')}`)}
          onRestore={() => onRestore(g.flag_key)} />
      ))}
    </div>
  )
}
function ArtistDupeCard({ g, isAdmin, ask, runMerge, onRenameArtist, onDismiss, onRestore }) {
  const [keep, setKeep] = useState(g.artists[0]?.id)
  const [editing, setEditing] = useState(null)
  const sources = g.artists.filter(a => a.id !== keep)
  const survivor = g.artists.find(a => a.id === keep)
  return (
    <GroupShell dismissed={g.dismissed} onDismiss={onDismiss} onRestore={onRestore}
      title={g.artists.map(a => a.name).join(' · ')}
      subtitle={g.dismissed ? `Dismissed by ${g.dismissed_by || '—'}` : 'Near-identical after normalization'}>
      <div className="space-y-2">
        {g.artists.map(a => (
          <div key={a.id} className={`flex items-center gap-3 rounded-lg border p-2.5 ${a.id === keep ? 'border-success/40 bg-success/10' : 'border-divider bg-elev'}`}>
            <input type="radio" name={`keepa-${g.flag_key}`} checked={a.id === keep} onChange={() => setKeep(a.id)} className="text-brand-600" />
            {editing === a.id ? (
              <InlineRename initial={a.name} onCancel={() => setEditing(null)} onSave={async (v) => { if (await onRenameArtist(a.id, v)) setEditing(null) }} />
            ) : (
              <>
                <Link to={`/artists/${a.id}`} className="text-sm font-semibold text-ink hover:text-brand-ink truncate">{a.name}</Link>
                {isAdmin && <button onClick={() => setEditing(a.id)} title="Rename — two records are not always a merge" className="text-ink-faint hover:text-brand-ink"><Pencil size={12} /></button>}
              </>
            )}
            <span className="ml-auto text-[11px] text-ink-muted tabular-nums shrink-0">{a.total_releases} release{a.total_releases === 1 ? '' : 's'} · {a.contract_count} contract{a.contract_count === 1 ? '' : 's'}</span>
          </div>
        ))}
      </div>
      {isAdmin && sources.length > 0 && (
        <button
          onClick={() => ask('Merge these artists?',
            `${sources.map(s => `"${s.name}"`).join(', ')} fold into "${survivor?.name}". Their releases, contracts, income, campaigns, dev-log entries, ledger rows and pipeline deals are all reassigned — then the folded records are deleted.`,
            () => runMerge('/flags/merge-artists', { target_id: keep, source_ids: sources.map(s => s.id) }, 'Artists merged'))}
          className="btn-secondary !py-1 text-xs mt-3"><GitMerge size={13} /> Merge {sources.length} into “{survivor?.name}”</button>
      )}
    </GroupShell>
  )
}
function InlineRename({ initial, onSave, onCancel }) {
  const [v, setV] = useState(initial)
  return (
    <form onSubmit={e => { e.preventDefault(); if (v.trim()) onSave(v.trim()) }} className="flex items-center gap-1.5 flex-1">
      <input autoFocus value={v} onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}
        className="input !py-1 text-xs flex-1" />
      <button type="submit" className="btn-primary !py-1 text-xs"><Check size={12} /></button>
      <button type="button" onClick={onCancel} className="text-ink-faint hover:text-ink"><X size={13} /></button>
    </form>
  )
}

// ── Duplicate vendors ───────────────────────────────────────────────────────
// Per-row "leave alone" exists because fuzzy matching pulls genuine third
// parties into a group ("Druz Media, LLC" beside "Prulo Media"). All-or-nothing
// meant either renaming a real vendor or dismissing the group and fixing
// nothing.
function VendorDupes({ cat, isAdmin, onDismiss, onRestore, ask, runMerge }) {
  return (
    <div className="space-y-3">
      {cat.groups.map(g => (
        <VendorDupeCard key={g.flag_key} g={g} isAdmin={isAdmin} ask={ask} runMerge={runMerge}
          onDismiss={() => onDismiss(g.flag_key, 'duplicate_vendors', `Duplicate vendors: ${g.vendors.map(v => v.payee).join(' / ')}`)}
          onRestore={() => onRestore(g.flag_key)} />
      ))}
    </div>
  )
}
function VendorDupeCard({ g, isAdmin, ask, runMerge, onDismiss, onRestore }) {
  const [keep, setKeep] = useState(g.vendors[0]?.payee)
  const [excluded, setExcluded] = useState(() => new Set())
  const toggle = (p) => setExcluded(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n })
  const sources = g.vendors.filter(v => v.payee !== keep && !excluded.has(v.payee))
  const left = g.vendors.filter(v => excluded.has(v.payee))
  return (
    <GroupShell dismissed={g.dismissed} onDismiss={onDismiss} onRestore={onRestore}
      title={g.vendors.map(v => v.payee).join(' · ')}
      subtitle={g.dismissed ? `Dismissed by ${g.dismissed_by || '—'}` : 'Same vendor under two spellings?'}>
      <div className="space-y-2">
        {g.vendors.map(v => {
          const isKeep = v.payee === keep
          const off = excluded.has(v.payee)
          return (
            <div key={v.payee} className={`flex items-center gap-3 rounded-lg border p-2.5 ${off ? 'border-divider bg-card opacity-60' : isKeep ? 'border-success/40 bg-success/10' : 'border-divider bg-elev'}`}>
              <input type="radio" name={`keepv-${g.flag_key}`} checked={isKeep} disabled={off} onChange={() => setKeep(v.payee)} className="text-brand-600" />
              {/* Plain text, not a link: vendors have no per-vendor route to
                  deep-link to, and a link that lands on an unfiltered list (or
                  on an admin-only page a non-admin can see this card from) is
                  worse than none. The metadata below is the evidence. */}
              <span className="text-sm font-semibold text-ink truncate">{v.payee}</span>
              <span className="text-[11px] text-ink-muted shrink-0">
                {v.invoice_count} invoice{v.invoice_count === 1 ? '' : 's'} · {usdRound(v.total_amount)}
                {v.has_w9 ? ' · W9' : ''}{v.last_invoice ? ` · last ${formatDate(v.last_invoice)}` : ''}
              </span>
              {!isKeep && (
                <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-ink-muted cursor-pointer shrink-0">
                  <input type="checkbox" checked={off} onChange={() => toggle(v.payee)} /> Leave alone
                </label>
              )}
            </div>
          )
        })}
      </div>
      {isAdmin && sources.length > 0 && (
        <button
          onClick={() => ask('Merge these vendor names?',
            `${sources.map(s => `"${s.payee}"`).join(', ')} are renamed to "${keep}" across the ledger, and each old spelling is kept as an ALIAS so future submissions and bank matches resolve to the survivor.${left.length ? ` Left alone: ${left.map(l => `"${l.payee}"`).join(', ')}.` : ''}`,
            () => runMerge('/flags/merge-vendors', { target_name: keep, source_names: sources.map(s => s.payee) }, 'Vendors merged'))}
          className="btn-secondary !py-1 text-xs mt-3"><GitMerge size={13} /> Merge {sources.length} into “{keep}”</button>
      )}
    </GroupShell>
  )
}

// ── W9 name ≠ payee ─────────────────────────────────────────────────────────
function W9Mismatch({ cat, isAdmin, onDismiss, onRestore, ask, runMerge }) {
  return (
    <div className="space-y-3">
      {cat.groups.map(g => (
        <GroupShell key={g.flag_key} dismissed={g.dismissed}
          onDismiss={() => onDismiss(g.flag_key, 'vendor_w9_mismatch', `W9 says "${g.w9_name}", ledger pays "${g.payee}"`)}
          onRestore={() => onRestore(g.flag_key)}
          title={g.payee} subtitle={g.dismissed ? `Dismissed by ${g.dismissed_by || '—'}` : null}
          badge={<ReasonChip>W9 name mismatch</ReasonChip>}>
          <p className="text-xs text-ink-muted">
            Ledger pays <span className="font-semibold text-ink">{g.payee}</span> · the W9 on entry{' '}
            <Link to={`/ledger?focus=${g.entry_id}`} className="text-brand-ink hover:underline">#{g.entry_id}</Link>{' '}
            reads <span className="font-semibold text-ink">{g.w9_name}</span>.
          </p>
          <p className="text-[11px] text-ink-faint mt-1">A trading name is fine — dismiss it. A wrong name on the W9 is a 1099 problem.</p>
          {isAdmin && (
            <button
              onClick={() => ask('Rename the payee to the W9 name?', `Every ledger row paying "${g.payee}" is renamed to "${g.w9_name}", and "${g.payee}" is kept as an alias.`,
                () => runMerge('/flags/merge-vendors', { target_name: g.w9_name, source_names: [g.payee] }, 'Vendor renamed'))}
              className="btn-secondary !py-1 text-xs mt-2"><GitMerge size={13} /> Use the W9 name</button>
          )}
        </GroupShell>
      ))}
    </div>
  )
}

// ── Duplicate invoices ──────────────────────────────────────────────────────
function InvoiceDupes({ cat, onDismiss, onRestore }) {
  return (
    <div className="space-y-3">
      {cat.groups.map(g => {
        const sev = sevOf(g.severity)
        const head = g.entries[0]
        return (
          <GroupShell key={g.flag_key} dismissed={g.dismissed}
            onDismiss={() => onDismiss(g.flag_key, 'duplicate_invoices', `${head?.payee || '—'} #${head?.invoice_number || '(no number)'} — ${g.entries.length} rows, ${g.reasons[0]}`)}
            onRestore={() => onRestore(g.flag_key)}
            title={<span className="inline-flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${sev.dot}`} />{head?.payee || '—'}{head?.invoice_number ? ` · #${head.invoice_number}` : ''}</span>}
            subtitle={g.dismissed ? `Dismissed by ${g.dismissed_by || '—'}` : null}
            badge={g.reasons.map(r => <ReasonChip key={r}>{r}</ReasonChip>)}>
            <div className="divide-y divide-divider">
              {g.entries.map(e => (
                <div key={e.id} className="flex items-center gap-3 py-1.5 text-xs">
                  <span className="text-ink-muted w-24 shrink-0">{formatDate(e.invoice_date)}</span>
                  <span className="text-ink truncate flex-1">{e.payee}{e.artist ? ` · ${e.artist}` : ''}{e.song ? ` · ${e.song}` : ''}</span>
                  {e.has_invoice && <FileText size={12} className="text-ink-muted shrink-0" title={e.invoice_filename || 'Invoice on file'} />}
                  <span className="text-ink-muted shrink-0">{e.payment_status}</span>
                  <span className="text-ink tabular-nums shrink-0">{money(e.amount, e.currency)}</span>
                  <Link to={`/ledger?focus=${e.id}`} title="Open in ledger" className="text-ink-faint hover:text-brand-ink shrink-0"><ExternalLink size={13} /></Link>
                </div>
              ))}
            </div>
          </GroupShell>
        )
      })}
    </div>
  )
}

// ── Generic group fallback (an unrecognised group-shaped category) ──────────
function GenericGroups({ cat, onDismiss, onRestore }) {
  return (
    <div className="space-y-3">
      {(cat.groups || []).map((g, i) => (
        <GroupShell key={g.flag_key || i} dismissed={g.dismissed}
          onDismiss={() => onDismiss(g.flag_key, cat.kind, cat.label)} onRestore={() => onRestore(g.flag_key)}
          title={g.title || g.label || g.flag_key}>
          <pre className="text-[11px] text-ink-muted overflow-x-auto">{JSON.stringify(g, null, 1)}</pre>
        </GroupShell>
      ))}
    </div>
  )
}

// ── Ledger flag rows ────────────────────────────────────────────────────────
// Every row can be fixed here. The inline editor pre-fills from whatever the
// server suggested, so accepting a suggestion is one keystroke and editing it
// is the same field.
function LedgerFlagRows({ cat, busyId, pending, onDismiss, onApplyFix, onUndoFix, onClearArtist, onSplit }) {
  const kind = cat.kind
  const field = kind === 'ledger_missing_song' ? 'song' : 'artist'
  // social_handles is a JSONB array of {platform, handle} pairs — there is no
  // single string to type, so those rows route to the ledger instead of
  // pretending an inline box could fill them.
  const inlineEditable = kind !== 'ledger_missing_socials'
  return (
    <div className="space-y-2">
      {cat.items.map(row => {
        const busy = busyId === row.id
        const p = pending[`${row.id}:${kind}`]
        const sug = row.suggestion
        const prefill =
          kind === 'ledger_missing_song' || kind === 'artist_missing' ? ''
            : (!Array.isArray(sug) && sug?.artist_name) ? sug.artist_name
              : (row.artist || '')
        return (
          <div key={row.flag_key || row.id} className={`card p-3.5 flex items-start gap-3 transition-all duration-500 ${p ? 'opacity-60 border-success/40 bg-success/10' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap text-[11px] text-ink-muted">
                <span className="font-mono">{formatDate(row.invoice_date)}</span>
                <span className="text-ink-faint">·</span>
                <span className="text-ink font-semibold truncate">{row.payee || '—'}</span>
                {row.category && <><span className="text-ink-faint">·</span><span>{row.category}</span></>}
                {kind === 'ledger_missing_song' && row.artist && <><span className="text-ink-faint">·</span><span className="truncate">{row.artist}</span></>}
                {kind !== 'ledger_missing_song' && row.song && <><span className="text-ink-faint">·</span><span className="italic truncate">{row.song}</span></>}
                {row.cobrand && <><span className="text-ink-faint">·</span><span className="text-[10px] font-bold uppercase tracking-wide text-info">Cobrand</span></>}
                {row.occurrence_count > 1 && <><span className="text-ink-faint">·</span><span>{row.occurrence_count} rows</span></>}
                {row.amount != null && <><span className="text-ink-faint">·</span><span className="tabular-nums">{money(row.amount, row.currency)}</span></>}
              </div>
              <div className="mt-1 flex items-center gap-2 flex-wrap text-sm">
                <span className={`font-semibold ${p ? 'line-through text-ink-muted' : 'text-danger'}`}>
                  {kind === 'ledger_missing_song' ? '(no song)'
                    : kind === 'ledger_missing_socials' ? '(no socials on file)'
                      : kind === 'artist_missing' ? '(empty)' : `"${row.artist || ''}"`}
                </span>
                {inlineEditable && !p && (
                  <form
                    // Keyed on row + kind + prefill so switching sections
                    // remounts the input; an uncontrolled field otherwise keeps
                    // the stale DOM value.
                    key={`${row.id}:${kind}:${prefill}`}
                    onSubmit={e => {
                      e.preventDefault()
                      const v = (e.currentTarget.elements.namedItem('fix')?.value || '').trim()
                      if (!v) return
                      onApplyFix(kind, row, field, v, row.flag_key)
                    }}
                    className="inline-flex items-center gap-1.5">
                    <span className="text-ink-faint">→</span>
                    <input name="fix" defaultValue={prefill} disabled={busy}
                      placeholder={field === 'song' ? 'Type song name' : 'Type artist name'}
                      className="input !py-1 text-xs !w-48" />
                    <button type="submit" disabled={busy} className="btn-primary !py-1 text-xs"><Check size={11} /> {busy ? '…' : 'Save'}</button>
                  </form>
                )}
                {kind === 'artist_placeholder' && !p && (
                  <button onClick={() => onClearArtist(kind, row)} disabled={busy}
                    title="This spend is not for one artist — remove the placeholder and leave the field empty"
                    className="btn-secondary !py-1 text-xs">No artist</button>
                )}
                {kind === 'artist_multi_name' && Array.isArray(sug) && <span className="text-xs text-ink-muted">→ split into {sug.map(s => `“${s}”`).join(', ')}</span>}
                {kind === 'artist_song_mismatch' && sug?.artist_name && <span className="text-xs text-ink-muted">→ “{sug.project_name}” is by <span className="font-semibold text-success">{sug.artist_name}</span></span>}
                {(kind === 'artist_likely_typo' || kind === 'artist_variants') && sug?.artist_name && <span className="text-xs text-ink-muted">→ suggested: <span className="font-semibold text-success">“{sug.artist_name}”</span></span>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {p ? (
                <button onClick={() => onUndoFix(kind, row)} disabled={busy} className="btn-secondary !py-1 text-xs"><RotateCcw size={12} /> Undo</button>
              ) : (
                <>
                  {!row.parent_id && kind !== 'artist_missing' && kind !== 'ledger_missing_song' && Number(row.amount) > 0 && (
                    <button onClick={() => onSplit(row)} title="Split this invoice across several artists" className="btn-secondary !py-1 text-xs"><Copy size={11} /> Split</button>
                  )}
                  <Link to={`/ledger?focus=${row.id}`} title="Open in ledger" className="p-1.5 rounded text-ink-faint hover:text-brand-ink"><ExternalLink size={13} /></Link>
                  <button onClick={() => onDismiss(row.flag_key, kind, `${row.payee || 'Entry'} #${row.id} — ${cat.label}`)} disabled={busy}
                    title="This one is fine" className="p-1.5 rounded text-ink-faint hover:text-danger disabled:opacity-40"><Ban size={13} /></button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Human-raised flags ──────────────────────────────────────────────────────
function FlaggedExpenses({ cat }) {
  return (
    <div className="card divide-y divide-divider">
      {cat.items.map(r => (
        <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
          <span className="text-ink-muted w-24 shrink-0">{formatDate(r.invoice_date)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-ink font-semibold truncate">{r.payee || '—'}{r.artist ? ` · ${r.artist}` : ''}{r.song ? ` · ${r.song}` : ''}</p>
            <p className="text-[11px] text-ink-muted truncate">{r.flag_reason || 'No reason given'} · flagged by {r.flagged_by || '—'} {formatDate(r.flagged_at, '')}</p>
          </div>
          <span className="text-ink tabular-nums shrink-0">{money(r.amount, r.currency)}</span>
          {/* Clearing a flag is the same toggle on the row — one owner, one place. */}
          <Link to={`/ledger?focus=${r.id}`} title="Open in ledger to clear the flag" className="text-ink-faint hover:text-brand-ink shrink-0"><ExternalLink size={13} /></Link>
        </div>
      ))}
    </div>
  )
}
function FlaggedTransactions({ cat }) {
  return (
    <div className="card divide-y divide-divider">
      {cat.items.map(t => (
        <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
          <span className="text-ink-muted w-24 shrink-0">{formatDate(t.txn_date)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-ink truncate">{t.payee_guess || t.description || '—'}</p>
            <p className="text-[11px] text-ink-muted truncate">{t.account || t.filename} · {t.direction}{t.is_booked ? ' · booked' : ' · open'}</p>
          </div>
          <span className="text-ink tabular-nums shrink-0">{money(t.amount, t.currency)}</span>
          <Link to={`/bank-statements/${t.statement_id}`} title="Open the statement" className="text-ink-faint hover:text-brand-ink shrink-0"><ExternalLink size={13} /></Link>
        </div>
      ))}
    </div>
  )
}

// ── Completeness lists ──────────────────────────────────────────────────────
function ReleaseList({ cat }) {
  return (
    <div className="card divide-y divide-divider">
      {cat.items.map(r => (
        <Link key={r.id} to={`/releases/${r.id}`} className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-brand-500/10 transition-colors">
          <span className="text-ink font-medium truncate flex-1">{r.project_name}</span>
          <span className="text-ink-muted truncate w-40 shrink-0">{r.artist_name || 'No artist'}</span>
          <span className="text-ink-muted w-24 shrink-0 text-right">{formatDate(r.release_date)}</span>
          <span className="text-[10px] font-semibold uppercase text-warning shrink-0 w-24 text-right">no {r.missing}</span>
        </Link>
      ))}
      {cat.count > cat.items.length && (
        <p className="px-4 py-2 text-[11px] text-ink-faint">Showing {cat.items.length} of {cat.count.toLocaleString()} — fix these and re-scan for the rest.</p>
      )}
    </div>
  )
}
function ArtistList({ cat }) {
  return (
    <div className="card divide-y divide-divider">
      {cat.items.map(a => (
        <Link key={a.id} to={`/artists/${a.id}`} className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-brand-500/10 transition-colors">
          <span className="text-ink font-medium truncate flex-1">{a.name}</span>
          <span className="text-ink-muted shrink-0">{a.total_releases} release{a.total_releases === 1 ? '' : 's'}</span>
          <span className="text-[10px] font-semibold uppercase text-warning shrink-0 w-24 text-right">no {a.missing}</span>
        </Link>
      ))}
      {cat.count > cat.items.length && (
        <p className="px-4 py-2 text-[11px] text-ink-faint">Showing {cat.items.length} of {cat.count.toLocaleString()} — fix these and re-scan for the rest.</p>
      )}
    </div>
  )
}

// ── Multi-artist normalization ──────────────────────────────────────────────
function MultiArtistSection({ cat, isAdmin, roster, rules, onApplyNormalization, onDeleteRule }) {
  const [manual, setManual] = useState({ pattern: '', base_artist: '' })
  const [manualErr, setManualErr] = useState(null)
  const submitManual = async () => {
    if (!manual.pattern.trim() || !manual.base_artist.trim()) { setManualErr('Both fields are required'); return }
    const r = await onApplyNormalization(manual.pattern.trim(), manual.base_artist.trim())
    if (r.ok) { setManual({ pattern: '', base_artist: '' }); setManualErr(null) } else setManualErr(r.error)
  }
  return (
    <div className="space-y-3">
      {!isAdmin && <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg p-2">Applying a normalization needs admin access.</div>}
      {cat.groups.map(g => (
        <MultiArtistCard key={g.source_key} g={g} isAdmin={isAdmin} roster={roster} onApply={onApplyNormalization} />
      ))}
      {cat.groups.length === 0 && <div className="card p-8 text-center"><p className="text-sm text-ink-muted">No multi-artist strings on file — nothing to normalize.</p></div>}

      <div className="card p-4">
        <h3 className="text-sm font-bold text-ink mb-1">Rules in force</h3>
        <p className="text-xs text-ink-muted mb-3">A stored rule renames matching rows on apply and keeps the string out of the flags above.</p>
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div><label className="label">Collab / variant string</label><input className="input !w-56" value={manual.pattern} onChange={e => setManual(m => ({ ...m, pattern: e.target.value }))} placeholder="Artist A & Artist B" /></div>
            <div><label className="label">Base artist</label><input className="input !w-48" value={manual.base_artist} onChange={e => setManual(m => ({ ...m, base_artist: e.target.value }))} placeholder="Artist A" /></div>
            <button onClick={submitManual} className="btn-primary"><Plus size={15} /> Apply & remember</button>
          </div>
        )}
        {manualErr && <p className="text-xs text-danger mb-2">{manualErr}</p>}
        <div className="divide-y divide-divider">
          {rules.length ? rules.map(m => (
            <div key={m.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-ink-muted">“{m.pattern}” → <span className="font-medium text-ink">{m.base_artist}</span></span>
              {isAdmin && <button onClick={() => onDeleteRule(m.id)} title="Delete the rule (rows stay renamed)" className="text-ink-faint hover:text-danger"><X size={14} /></button>}
            </div>
          )) : <p className="text-xs text-ink-faint">No rules yet.</p>}
        </div>
      </div>
    </div>
  )
}
function MultiArtistCard({ g, isAdmin, roster, onApply }) {
  const [pick, setPick] = useState(g.candidates?.[0] || '')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // Capped at 8 — the operator refines the query if what they want is not in
  // the visible set; a 5,000-row dropdown is not a picker.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return roster.filter(a => a.name.toLowerCase().includes(q)).slice(0, 8)
  }, [query, roster])
  const current = query.trim() || pick
  const apply = async () => {
    if (!current) { setErr('Pick a base artist first'); return }
    setBusy(true); setErr(null)
    const r = await onApply(g.source_display || g.source_key, current)
    if (!r.ok) setErr(r.error)
    setBusy(false)
  }
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <Copy size={12} className="text-brand-ink" />
        <span className="text-[11px] font-semibold text-brand-ink bg-brand-500/10 px-2 py-0.5 rounded-full">Multi-artist string</span>
        <span className="ml-auto text-[11px] text-ink-muted">{g.row_count} row{g.row_count === 1 ? '' : 's'} · {usdRound(g.total_amount)}</span>
      </div>
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wide font-bold text-ink-muted mb-1">Current artist string</div>
        <div className="text-sm font-semibold text-ink bg-elev border border-divider rounded px-3 py-2 truncate" title={g.source_display}>{g.source_display}</div>
      </div>
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wide font-bold text-ink-muted mb-1.5">Base artist</div>
        {g.candidates?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {g.candidates.map(c => (
              <label key={c} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
                !query.trim() && pick === c ? 'bg-success/10 border-success/40 text-ink' : 'bg-card border-rule text-ink-muted hover:bg-elev'}`}>
                <input type="radio" name={`base-${g.source_key}`} className="sr-only" checked={!query.trim() && pick === c}
                  onChange={() => { setPick(c); setQuery('') }} disabled={busy || !isAdmin} />
                {c}
              </label>
            ))}
          </div>
        )}
        <div className="relative">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Or search all artists…" disabled={busy || !isAdmin} className="input !py-1.5 text-xs" />
          {matches.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-card border border-rule rounded-lg shadow-elevated max-h-56 overflow-y-auto">
              {matches.map(a => (
                <button key={a.id} type="button" onClick={() => { setQuery(a.name); setPick(a.name) }} className="w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-brand-500/10">{a.name}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {err && <p className="text-xs text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1 mb-2">{err}</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-muted">
          Will rename <span className="font-bold text-ink">{g.row_count}</span> row{g.row_count === 1 ? '' : 's'} to <span className="font-bold text-ink">{current || '—'}</span> and remember the mapping.
        </p>
        <button onClick={apply} disabled={busy || !isAdmin || !current} className="btn-primary !py-1.5 text-xs shrink-0">{busy ? 'Applying…' : 'Apply'}</button>
      </div>
    </div>
  )
}

// ── Dismissed ───────────────────────────────────────────────────────────────
// The stored summary is the copy. The flag key is a machine identifier and
// prints small, for the case where someone needs to match it to a payload.
function DismissedList({ rows, onRestore }) {
  if (!rows.length) return <div className="card p-5 text-center text-xs text-ink-muted">Nothing dismissed.</div>
  return (
    <div className="card divide-y divide-divider">
      <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Dismissed ({rows.length})</p>
      {rows.map(d => (
        <div key={d.flag_key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <div className="min-w-0 flex-1">
            <p className="text-ink truncate">{d.summary || d.kind || 'Dismissed flag'}</p>
            <p className="text-[11px] text-ink-muted truncate">
              dismissed by {d.dismissed_by || '—'} {formatDate(d.dismissed_at, '')}
              {d.note ? ` · ${d.note}` : ''} · <span className="font-mono text-ink-faint">{d.flag_key}</span>
            </p>
          </div>
          <button onClick={() => onRestore(d.flag_key)} className="text-xs font-semibold text-brand-ink hover:underline inline-flex items-center gap-1 shrink-0"><RotateCcw size={13} /> Restore</button>
        </div>
      ))}
    </div>
  )
}

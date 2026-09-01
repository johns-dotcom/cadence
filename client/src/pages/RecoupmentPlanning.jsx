// Recoupment upload planning — /recoupments/planning
//
// The staging area between "picked on Recoupments" and "committed to this
// month's statement":
//
//   1. Somebody selects items on Recoupments (or an artist page) and presses
//      "Add to plan" — they land here.
//   2. Here they get GROUPED into named upload batches (`recoupment_label`),
//      moved between labels, inspected, split, flagged, or dropped.
//   3. "Done" marks every staged item UFR, stamping its label on the way. The
//      upload date decides the statement (server/lib/statementMonth.js).
//
// The plan itself is a client-side working set (lib/recoupmentPlan.js) — see
// that file for why a draft decision does not belong in a shared table. This
// page never invents money: `GET /financials/planning` decides what is
// ELIGIBLE, the plan decides what is STAGED, and the two are reconciled on
// every load so an item claimed from another surface prunes itself.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Check, ChevronDown, ChevronRight, ExternalLink, Flag, Layers,
  Bookmark, Music2, Plus, RotateCcw, Scissors, Star, Tag, Trash2, Undo2, Upload,
  X, AtSign, Paperclip, ClipboardList, MoveRight,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import SplitModal from '../components/SplitModal'
import BankEvidenceDot from '../components/BankEvidenceDot'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { money, moneyOrig, moneyByCurrency, totalsByCurrency } from '../utils/money'
import { STATE_LABEL } from '../utils/recoupState'
import useCollapsed from '../hooks/useCollapsed'
import useFocusRefetch from '../hooks/useFocusRefetch'
import { ConfirmDialog } from '../components/ui'
import {
  loadPlan, addToPlan, removeFromPlan, setLabelForItems,
  clearPlan, planSize, loadDeferred, saveDeferred,
} from '../lib/recoupmentPlan'

const NOTE_KEY = '__recoupments_planning__'

// The bucket an item's artist card keys on. '' would collide with a real empty
// label, so the no-artist bucket gets its own sentinel.
const artistKey = (r) => String(r.artist || '').trim().toLowerCase() || '__noartist__'
const artistName = (r) => String(r.artist || '').trim() || '(no artist)'

function socialsList(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map(s => {
      const platform = String(s?.platform || '').trim()
      const handle = String(s?.handle || '').trim()
      if (!handle) return null
      return { platform, handle, display: (platform ? `${platform} ${handle}` : handle) + (s?.amount ? ` · $${s.amount}` : '') }
    })
    .filter(Boolean)
}

// Most-used spelling wins, ties to the longest — the same rule the server's
// `bestSpelling` follows, so a card is titled the way the rest of the app
// spells the artist.
const bestName = (names) => {
  const c = new Map()
  for (const n of names) c.set(n, (c.get(n) || 0) + 1)
  let best = names[0]; let bn = -1
  for (const [n, k] of c) if (k > bn || (k === bn && String(n).length > String(best).length)) { best = n; bn = k }
  return best
}

const curTotals = (items) => totalsByCurrency(items, r => Number(r.amount || 0))
const usdTotal = (items) => items.reduce((s, r) => s + Number(r.amount_usd || 0), 0)
// "USD 1,200.00 · EUR 500.00 ≈ $1,742.10" — the ≈ suffix only appears when
// more than one currency is in play, because a single-currency total is exact.
const totalsLine = (items) => {
  const t = curTotals(items)
  const keys = Object.keys(t)
  if (!keys.length) return '—'
  return moneyByCurrency(t) + (keys.length > 1 ? ` ≈ ${money(usdTotal(items))}` : '')
}

export default function RecoupmentPlanning() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [plan, setPlan] = useState(loadPlan)
  const [deferred, setDeferred] = useState(loadDeferred)
  const [sel, setSel] = useState(() => new Set())
  const [labels, setLabels] = useState([])
  const [commitError, setCommitError] = useState('')
  const [busy, setBusy] = useState(false)
  const [groupMode, setGroupMode] = useState('song')     // song | label
  const [confirm, setConfirm] = useState(null)
  const [splitting, setSplitting] = useState(null)
  const [labelMenu, setLabelMenu] = useState(null)       // { ids, current, top, left }
  const [preview, setPreview] = useState(null)           // { url, name }
  const [undo, setUndo] = useState(null)
  const [copied, setCopied] = useState(false)
  const [note, setNote] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const undoTimer = useRef(null)
  const { isCollapsed, toggleCollapsed } = useCollapsed('recoup_plan_collapsed_v1')

  const [searchParams, setSearchParams] = useSearchParams()
  const selectedArtist = (searchParams.get('artist') || '').trim().toLowerCase() || null
  const focusId = Number(searchParams.get('focus')) || null
  const setSelectedArtist = (key) => setSearchParams(prev => {
    const next = new URLSearchParams(prev)
    if (key) next.set('artist', key); else next.delete('artist')
    next.delete('focus')
    return next
  }, { replace: true })

  const showUndo = (text, run) => {
    clearTimeout(undoTimer.current)
    setUndo({ text, run })
    undoTimer.current = setTimeout(() => setUndo(null), 10000)
  }
  useEffect(() => () => clearTimeout(undoTimer.current), [])

  // ── Load ──────────────────────────────────────────────────────────────────
  // A failed fetch used to be swallowed, so the page rendered "Nothing to plan"
  // — indistinguishable from success on a page whose whole job is to show what
  // is outstanding. It now has its own state and a Retry.
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    return api.get('/financials/planning')
      .then(r => { setRows(r.data.data || []); setMeta(r.data.meta || null); setError(false) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useFocusRefetch(() => load(true))
  useEffect(() => { api.get('/financials/recoupments/labels').then(r => setLabels((r.data.data || []).map(l => l.label))).catch(() => {}) }, [])

  useEffect(() => {
    api.get('/financials/recoupments/notes', { params: { artist: NOTE_KEY } })
      .then(r => setNote(r.data.data?.artistNote || '')).catch(() => {})
  }, [])
  const saveNote = async (value) => {
    if (value === note) return
    setNoteSaving(true)
    try { await api.post('/financials/recoupments/notes', { artist: NOTE_KEY, note: value }); setNote(value) }
    catch { toast('Failed to save the note', 'error') }
    finally { setNoteSaving(false) }
  }

  // Another tab (Recoupments) can stage more items while this one sits open.
  useEffect(() => {
    const rehydrate = () => setPlan(loadPlan())
    window.addEventListener('focus', rehydrate)
    return () => window.removeEventListener('focus', rehydrate)
  }, [])

  // ── Plan ↔ eligibility reconciliation ─────────────────────────────────────
  // The server's list IS the eligibility rule (recoupable, approved, live,
  // reviewed, not already claimed, not prior-year). Anything staged that is no
  // longer in it was claimed, deleted or un-recouped elsewhere, and is pruned
  // silently — that is a valid parallel workflow, not an error.
  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows])
  const { planItems, staleIds } = useMemo(() => {
    if (loading || error) return { planItems: [], staleIds: [] }
    const items = []
    const stale = []
    for (const id of Object.keys(plan).map(Number)) {
      const found = byId.get(id)
      if (found) items.push(found); else stale.push(id)
    }
    return { planItems: items, staleIds: stale }
  }, [byId, plan, loading, error])
  // Pruned in an effect, never during render — the prune is a WRITE (both to
  // state and to localStorage) and a render must stay a pure read.
  useEffect(() => { if (staleIds.length) setPlan(removeFromPlan(staleIds)) }, [staleIds])

  const artistCards = useMemo(() => {
    const by = new Map()
    for (const r of planItems) {
      const k = artistKey(r)
      if (!by.has(k)) by.set(k, { key: k, items: [], names: [] })
      by.get(k).items.push(r)
      by.get(k).names.push(artistName(r))
    }
    return [...by.values()]
      .map(b => ({
        key: b.key,
        items: b.items,
        name: bestName(b.names),
        usd: usdTotal(b.items),
        unlabeled: b.items.filter(i => (plan[i.id] ?? '') === '').length,
        ready: !!meta?.artist_meta?.[normKey(b.items[0].artist)]?.ready_for_planning,
        flagged: !!meta?.artist_meta?.[normKey(b.items[0].artist)]?.flagged,
        flag_reason: meta?.artist_meta?.[normKey(b.items[0].artist)]?.flag_reason || null,
      }))
      // Ready-for-planning pins above the rest, then biggest staged batch
      // first — the plan is worked in money order, not alphabetically (which is
      // all the server can offer). The ready marker is a decision about
      // attention that somebody made on Recoupments or Campaigns; a sort that
      // buried it would be the third surface to ignore it.
      .sort((a, b) => (Number(b.ready) - Number(a.ready)) || b.usd - a.usd || a.name.localeCompare(b.name))
  }, [planItems, plan, meta])

  const activeCards = artistCards.filter(c => !deferred.has(c.key))
  const deferredCards = artistCards.filter(c => deferred.has(c.key))
  const activeItems = useMemo(() => activeCards.flatMap(c => c.items), [activeCards])
  const deferredItems = useMemo(() => deferredCards.flatMap(c => c.items), [deferredCards])
  const current = selectedArtist ? artistCards.find(c => c.key === selectedArtist) || null : null

  // Song → category, spend desc, "(no song)" sunk to the bottom.
  const songSections = useMemo(() => {
    if (!current) return []
    const bySong = new Map()
    for (const it of current.items) {
      const raw = String(it.song || '').trim()
      const k = raw.toLowerCase() || '__nosong__'
      if (!bySong.has(k)) bySong.set(k, { key: k, name: raw || '(no song)', cats: new Map() })
      const cat = String(it.category || '').trim() || 'Uncategorized'
      const s = bySong.get(k)
      if (!s.cats.has(cat)) s.cats.set(cat, [])
      s.cats.get(cat).push(it)
    }
    return [...bySong.values()].map(s => {
      const items = [...s.cats.values()].flat()
      return {
        key: s.key, name: s.name, items,
        ready: !!(meta?.song_status || []).find(x => x.artist_key === normKey(current.name) && x.song_key === s.key && x.ready_for_planning),
        categories: [...s.cats.entries()].sort((a, b) => a[0].localeCompare(b[0]))
          .map(([cat, list]) => ({ cat, items: sortByDate(list) })),
      }
    }).sort((a, b) => {
      if ((a.key === '__nosong__') !== (b.key === '__nosong__')) return a.key === '__nosong__' ? 1 : -1
      return usdTotal(b.items) - usdTotal(a.items)
    })
  }, [current, meta])

  // The same renderer serves "By label": one pseudo-category holding the whole
  // bucket, unlabeled first because that is the to-do pile.
  const labelSections = useMemo(() => {
    if (!current) return []
    const by = new Map()
    for (const it of current.items) {
      const l = plan[it.id] || ''
      if (!by.has(l)) by.set(l, [])
      by.get(l).push(it)
    }
    return [...by.entries()].map(([l, items]) => ({
      key: `__label__${l || '__unlabeled__'}`,
      name: l || '(unlabeled)',
      unlabeled: !l,
      items: sortByDate(items),
      categories: [{ cat: '__ALL__', items: sortByDate(items) }],
    })).sort((a, b) => (Number(b.unlabeled) - Number(a.unlabeled)) || a.name.localeCompare(b.name))
  }, [current, plan])

  const sections = current ? (groupMode === 'label' ? labelSections : songSections) : []

  // Labels offered in the pickers: scoped to the drilled-in artist so one
  // artist's batches don't clutter another's menu, plus the workspace
  // vocabulary so an existing batch name is one click rather than retyped.
  const planLabels = useMemo(() => [...new Set(Object.values(plan).filter(Boolean))].sort(), [plan])
  const offeredLabels = useMemo(() => {
    const own = current ? [...new Set(current.items.map(i => plan[i.id] || '').filter(Boolean))] : planLabels
    return [...new Set([...own, ...labels])].sort()
  }, [current, plan, planLabels, labels])

  // ── Selection ─────────────────────────────────────────────────────────────
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const setMany = (items, on) => setSel(s => {
    const n = new Set(s)
    items.forEach(r => on ? n.add(r.id) : n.delete(r.id))
    return n
  })
  const allOn = (items) => items.length > 0 && items.every(r => sel.has(r.id))
  const selRows = planItems.filter(r => sel.has(r.id))

  // ── ?focus=<id> ───────────────────────────────────────────────────────────
  // Selects the row's artist, scrolls to it and spotlights it briefly — the
  // deep link a Ledger row (or a colleague's URL) uses to point at one staged
  // item rather than at the page.
  useEffect(() => {
    if (loading || !focusId) return
    const item = byId.get(focusId)
    if (!item) return
    const key = artistKey(item)
    if (selectedArtist !== key) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        next.set('artist', key)
        return next
      }, { replace: true })
      return
    }
    const el = document.getElementById(`plan-item-${focusId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // The spotlight is an ANSWER to "which one", so it expires — a ring that
    // never clears stops distinguishing anything.
    const t = setTimeout(() => setSearchParams(prev => {
      const next = new URLSearchParams(prev); next.delete('focus'); return next
    }, { replace: true }), 3200)
    return () => clearTimeout(t)
  }, [loading, focusId, byId, selectedArtist]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bounce back to the cards when the drilled-in artist's last item leaves.
  useEffect(() => {
    if (!loading && !error && selectedArtist && planItems.length && !artistCards.some(c => c.key === selectedArtist)) {
      setSelectedArtist(null)
    }
  }, [loading, error, selectedArtist, artistCards, planItems.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Plan mutations (local only — nothing reaches the ledger) ───────────────
  const stage = (ids, label = '') => setPlan(addToPlan(ids, label))
  const unstage = (ids) => {
    setPlan(removeFromPlan(ids))
    setSel(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n })
  }
  const applyLabel = (ids, label) => { setPlan(setLabelForItems(ids, label)); setLabelMenu(null) }

  const toggleDefer = (key) => {
    const next = new Set(deferred)
    if (next.has(key)) next.delete(key)
    else {
      next.add(key)
      // Deferring an artist must not leave their rows sitting inside a
      // selection that "Upload N" would then send anyway.
      const card = artistCards.find(c => c.key === key)
      if (card) setSel(s => { const n = new Set(s); card.items.forEach(r => n.delete(r.id)); return n })
    }
    setDeferred(saveDeferred(next))
  }

  const resetPlan = () => setConfirm({
    title: 'Discard the whole plan?',
    message: `${planSize(plan)} staged item${planSize(plan) === 1 ? '' : 's'} will be un-staged. Nothing changes on the ledger — this only clears the working set.`,
    onConfirm: () => { setPlan(clearPlan()); setSel(new Set()); setConfirm(null); toast('Plan cleared') },
  })

  // ── Ledger writes ─────────────────────────────────────────────────────────
  const patchRow = async (row, patch, label) => {
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, ...patch } : r))
    try {
      await api.patch(`/ledger/entries/${row.id}`, patch)
      if (label) {
        const revert = Object.fromEntries(Object.keys(patch).map(k => [k, row[k] ?? null]))
        showUndo(label, async () => { await api.patch(`/ledger/entries/${row.id}`, revert); load(true) })
      }
      load(true)
    } catch (err) {
      setRows(rs => rs.map(r => r.id === row.id ? row : r))   // exact rollback
      toast(err.response?.data?.error || 'Failed', 'error')
    }
  }

  // Per-row claim. It carries the row's staged label, because the bulk commit
  // does — a per-row button that dropped it landed the item on the statement
  // unlabeled, in a batch named for everything else.
  const claimRow = async (row) => {
    const label = plan[row.id] || ''
    try {
      if (label) await api.post('/financials/recoupments/set-label', { ids: [row.id], label, mark_ufr: true })
      else await api.post('/financials/recoupments/ufr-bulk', { ids: [row.id], ufr: true })
      unstage([row.id])
      toast(`Uploaded for recoupment${label ? ` · ${label}` : ''}`)
      showUndo('Uploaded for recoupment', async () => {
        await api.post('/financials/recoupments/ufr-bulk', { ids: [row.id], ufr: false })
        stage([row.id], label); load(true)
      })
      load(true)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const flagRow = async (row) => {
    const next = !row.flagged
    const reason = next ? (window.prompt('Why is this flagged? (optional)', row.flag_reason || '') ?? '') : ''
    try {
      await api.post(`/ledger/entries/${row.id}/flag`, { flagged: next, flag_reason: reason || null })
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, flagged: next, flag_reason: next ? (reason || null) : null } : r))
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const flagArtist = async (card) => {
    const next = !card.flagged
    const reason = next ? (window.prompt(`Why is ${card.name} flagged? (optional)`, card.flag_reason || '') ?? '') : ''
    try {
      await api.post('/financials/recoupments/artist-meta', { artist: card.name, flagged: next, flag_reason: reason || null })
      load(true)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const deleteRow = (row) => setConfirm({
    title: `Delete ${row.payee || 'this entry'}?`,
    message: 'It is soft-deleted — split children go with it, and it can be restored from the Ledger.',
    onConfirm: async () => {
      setConfirm(null)
      try {
        await api.delete(`/ledger/entries/${row.id}`)
        unstage([row.id])
        showUndo(`Deleted ${row.payee || 'entry'}`, async () => { await api.post(`/ledger/entries/${row.id}/restore`); stage([row.id]); load(true) })
        load(true)
      } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    },
  })

  const openFile = async (row) => {
    const type = row.invoice_filename ? 'invoice' : 'receipt'
    try {
      const { data: blob } = await api.get(`/ledger/entries/${row.id}/file/${type}`, { responseType: 'blob' })
      setPreview({ url: URL.createObjectURL(blob), name: row.invoice_filename || row.receipt_filename })
    } catch { toast('Could not open the file', 'error') }
  }

  const bulkSetSong = async () => {
    if (!selRows.length) return
    const raw = window.prompt(`Set song for ${selRows.length} item${selRows.length === 1 ? '' : 's'} (blank clears it):`, '')
    if (raw === null) return
    const song = raw.trim() || null
    setBusy(true)
    try {
      await Promise.all(selRows.map(r => api.patch(`/ledger/entries/${r.id}`, { song })))
      toast(`Song set on ${selRows.length}`)
      load(true)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(false) }
  }

  // ── Commit ────────────────────────────────────────────────────────────────
  // One request per label bucket (`set-label … mark_ufr`) plus one for the
  // unlabeled bucket (`ufr-bulk`) — the unlabeled rows deliberately do NOT go
  // through set-label, which would CLEAR a label the row already carried.
  //
  // Failure reporting is done by re-reading, not by trusting the response:
  // after the writes, anything still in the eligible pool was not claimed, so
  // it stays staged and is named in the banner. That is exact, and it
  // self-heals when a row moved under the caller for a reason nobody predicted.
  const runCommit = async (items, { navigateOnClean = false } = {}) => {
    if (!items.length || busy) return
    setBusy(true); setCommitError('')
    const buckets = new Map()
    for (const it of items) {
      const l = plan[it.id] || ''
      if (!buckets.has(l)) buckets.set(l, [])
      buckets.get(l).push(it.id)
    }
    let hardError = ''
    for (const [label, ids] of buckets) {
      try {
        if (label) await api.post('/financials/recoupments/set-label', { ids, label, mark_ufr: true })
        else await api.post('/financials/recoupments/ufr-bulk', { ids, ufr: true })
      } catch (err) {
        hardError = err.response?.data?.error || err.message
      }
    }
    // Re-read and reconcile.
    let fresh = []
    try { fresh = (await api.get('/financials/planning')).data.data || [] }
    catch { setBusy(false); setCommitError('Committed, but the page could not reload — refresh to see the result.'); return }
    setRows(fresh)
    const stillEligible = new Set(fresh.map(r => r.id))
    const committed = items.filter(it => !stillEligible.has(it.id))
    const failed = items.filter(it => stillEligible.has(it.id))
    setPlan(removeFromPlan(committed.map(it => it.id)))
    setSel(new Set())
    setBusy(false)

    if (failed.length) {
      const sample = failed.slice(0, 3).map(f => `#${f.id} ${f.payee || ''}`).join('\n')
      setCommitError(
        `${failed.length} item${failed.length === 1 ? '' : 's'} did not go through and stay staged:\n${sample}`
        + (failed.length > 3 ? `\n…and ${failed.length - 3} more` : '')
        + (hardError ? `\n\nServer said: ${hardError}` : ''))
      toast(`${committed.length} uploaded · ${failed.length} still staged`, 'error')
      return
    }
    toast(`${committed.length} uploaded for recoupment`)
    if (navigateOnClean && planSize(loadPlan()) === 0) navigate('/recoupments')
  }

  const commitAll = () => {
    if (!activeItems.length) return
    setConfirm({
      title: `Upload ${activeItems.length} item${activeItems.length === 1 ? '' : 's'} for recoupment?`,
      message: `They land on the statement their upload date falls in, with their labels stamped. Removing them afterwards is a separate action.`
        + (deferredItems.length ? ` ${deferredItems.length} saved-for-later item${deferredItems.length === 1 ? '' : 's'} stay staged.` : ''),
      onConfirm: () => { setConfirm(null); runCommit(activeItems, { navigateOnClean: true }) },
    })
  }

  const commitSelected = () => {
    if (!selRows.length) return
    setConfirm({
      title: `Upload the ${selRows.length} selected item${selRows.length === 1 ? '' : 's'}?`,
      message: 'They land on this statement with their labels stamped. The rest of the plan stays staged.',
      onConfirm: () => { setConfirm(null); runCommit(selRows) },
    })
  }

  // ── Copy list ─────────────────────────────────────────────────────────────
  const copyList = async () => {
    if (!planItems.length) return
    const buckets = new Map()
    for (const it of planItems) {
      const l = plan[it.id] || ''
      if (!buckets.has(l)) buckets.set(l, [])
      buckets.get(l).push(it)
    }
    const lines = ['Planned for the next recoupment upload:', '']
    for (const [label, items] of [...buckets.entries()].sort((a, b) => (a[0] ? 1 : -1) || a[0].localeCompare(b[0]))) {
      lines.push(`${label || 'Unlabeled'} — ${items.length} item${items.length === 1 ? '' : 's'} · ${totalsLine(items)}`)
      for (const it of sortByDate(items)) {
        const date = it.payment_date ? `paid ${formatDate(it.payment_date)}` : (it.invoice_date ? formatDate(it.invoice_date) : '(no date)')
        lines.push(`  • ${artistName(it)} · ${it.payee || '—'}${it.song ? ` · ${it.song}` : ''} · ${moneyOrig(it.amount, it.currency)} · ${date}`)
      }
      lines.push('')
    }
    lines.push(`Total: ${planItems.length} item${planItems.length === 1 ? '' : 's'} — ${totalsLine(planItems)}`)
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch { window.prompt('Copy the plan:', text) }
  }

  // ── Summary strip ─────────────────────────────────────────────────────────
  // Scoped to the drilled-in artist, so the big numbers always describe what is
  // on screen. The commit button stays plan-wide and says its own count.
  const stripItems = current ? current.items : activeItems
  const stripLabels = new Set()
  let stripUnlabeled = 0
  for (const it of stripItems) { const l = plan[it.id] || ''; if (l) stripLabels.add(l); else stripUnlabeled++ }

  const row = (r) => (
    <Row key={r.id} r={r} selected={sel.has(r.id)} focused={focusId === r.id}
      label={plan[r.id] || ''}
      showSong={groupMode === 'label'}
      onSelect={() => toggle(r.id)}
      onLabel={(e) => openLabelMenu(e, [r.id], plan[r.id] || '')}
      onClaim={() => claimRow(r)}
      onUnrecoup={() => patchRow(r, { recoupable: false }, 'Marked not recoupable')}
      onCobrand={() => patchRow(r, { cobrand: !r.cobrand, ...(r.cobrand ? {} : { category: 'Marketing' }) }, 'Cobrand toggled')}
      onSplit={() => setSplitting(r)}
      onFlag={() => flagRow(r)}
      onFile={() => openFile(r)}
      onDelete={() => deleteRow(r)}
      onRemove={() => unstage([r.id])} />
  )

  const openLabelMenu = (e, ids, currentLabel) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setLabelMenu({
      ids, current: currentLabel || '',
      top: Math.min(rect.bottom + 6, window.innerHeight - 260),
      left: Math.min(Math.max(8, rect.left), window.innerWidth - 256),
    })
  }

  return (
    <div className="pb-28">
      <Link to="/recoupments" className="inline-flex items-center gap-1.5 mb-3 px-2.5 py-1 rounded-lg text-xs font-semibold text-ink-muted border border-rule hover:text-ink hover:bg-brand-500/5">
        <ArrowLeft size={13} /> Recoupments
      </Link>

      <PageHeader
        title="Recoupment planning"
        subtitle="Stage items into named upload batches, then upload them — the upload date decides the statement"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={copyList} disabled={!planItems.length} className="btn-secondary disabled:opacity-40">
              {copied ? <Check size={14} className="text-success" /> : <ClipboardList size={14} />} {copied ? 'Copied' : 'Copy list'}
            </button>
            <button onClick={resetPlan} disabled={!planItems.length || busy} className="btn-secondary text-danger disabled:opacity-40">
              <RotateCcw size={14} /> Reset plan
            </button>
            <button onClick={commitAll} disabled={!activeItems.length || busy}
              title={activeItems.length ? `Upload ${activeItems.length} for recoupment${deferredItems.length ? ` — ${deferredItems.length} saved for later stay staged` : ''}` : 'Stage items from Recoupments first'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white bg-success hover:opacity-90 disabled:opacity-40 shadow-sm">
              <Check size={15} /> {busy ? 'Uploading…' : `Done · Upload ${activeItems.length}`}
            </button>
          </div>
        } />

      {/* Summary strip. */}
      <div className="card px-5 py-4 mb-4 flex items-baseline gap-8 flex-wrap">
        <Stat label={`In plan${current ? ` · ${current.name}` : ''}`} value={stripItems.length} />
        <Stat label="Batches" value={stripLabels.size}
          extra={stripUnlabeled > 0 ? <span className="text-sm font-semibold text-warning ml-2">+ {stripUnlabeled} unlabeled</span> : null} />
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">Total</p>
          <p className={`font-bold text-success tabular-nums mt-1 ${Object.keys(curTotals(stripItems)).length > 1 ? 'text-base' : 'text-2xl'}`}>
            {stripItems.length ? moneyByCurrency(curTotals(stripItems)) : <span className="text-ink-faint text-2xl">—</span>}
          </p>
        </div>
        {stripItems.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">Total (USD)</p>
            <p className="text-2xl font-bold text-success tabular-nums mt-1">
              {Object.keys(curTotals(stripItems)).length > 1 ? '≈ ' : ''}{money(usdTotal(stripItems))}
            </p>
          </div>
        )}
        {deferredItems.length > 0 && !current && (
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">Saved for later</p>
            <p className="text-2xl font-bold text-ink-muted tabular-nums mt-1">{deferredItems.length}</p>
          </div>
        )}
      </div>

      {/* Batch scratchpad — the same recoupment_notes table the index uses,
          under its own sentinel key. */}
      <div className="card p-3 mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Batch notes</span>
          {noteSaving && <span className="text-[10px] text-ink-faint italic">saving…</span>}
        </div>
        <textarea defaultValue={note} rows={2} maxLength={4000} onBlur={e => saveNote(e.target.value)}
          placeholder="What this upload covers, what is blocked, what is waiting on an invoice — anything the next person working the plan should know."
          className="input text-xs w-full resize-y" />
      </div>

      {commitError && (
        <div className="card p-3 mb-4 border-l-4 border-l-danger">
          <p className="text-xs text-danger font-semibold whitespace-pre-line">{commitError}</p>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={8} cols={4} /></div>
      ) : error ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-muted mb-3">Couldn’t load the eligible pool — the plan below may be out of date.</p>
          <button onClick={() => load()} className="btn-secondary">Retry</button>
        </div>
      ) : planItems.length === 0 ? (
        <div className="card p-10 text-center">
          <Layers size={28} className="text-ink-faint mx-auto mb-3" />
          <p className="text-sm font-semibold text-ink">Nothing staged yet.</p>
          <p className="text-xs text-ink-muted mt-1 max-w-md mx-auto">
            {rows.length === 0
              ? 'There is also nothing eligible — every recoupable entry is already on a statement.'
              : <>Pick items on <Link to="/recoupments" className="font-semibold text-brand-ink hover:underline">Recoupments</Link> and press “Add to plan”. {rows.length} entr{rows.length === 1 ? 'y is' : 'ies are'} eligible.</>}
          </p>
        </div>
      ) : current ? (
        /* ── Artist drill-down ── */
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button onClick={() => setSelectedArtist(null)} className="btn-secondary !py-1.5 text-xs"><ArrowLeft size={13} /> All artists</button>
            <span className="text-sm font-bold text-ink">{current.name}</span>
            <span className="text-xs text-ink-muted tabular-nums">{current.items.length} staged · {totalsLine(current.items)}</span>
            <span className="flex-1" />
            <div className="inline-flex rounded-lg border border-rule overflow-hidden">
              {[['song', 'By song'], ['label', 'By batch']].map(([k, l]) => (
                <button key={k} onClick={() => setGroupMode(k)}
                  className={`text-[11px] font-semibold px-2.5 py-1.5 ${groupMode === k ? 'bg-brand-600 text-white' : 'text-ink-muted hover:bg-brand-500/10'}`}>{l}</button>
              ))}
            </div>
            <button onClick={() => setMany(current.items, !allOn(current.items))} className="text-xs font-semibold text-brand-ink hover:underline">
              {allOn(current.items) ? 'Deselect all' : 'Select all'}
            </button>
            <Link to={`/recoupments/artist/${encodeURIComponent(normKey(current.name) || '-')}`} className="text-xs font-semibold text-ink-muted hover:text-brand-ink inline-flex items-center gap-1">
              Recoupments page <ChevronRight size={12} />
            </Link>
          </div>

          <div className="space-y-3">
            {sections.map(s => {
              const secKey = `s:${current.key}:${s.key}`
              const open = !isCollapsed(secKey)
              return (
                <div key={s.key} className="card overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-page/40 border-b border-divider">
                    <Check4 checked={allOn(s.items)} onChange={() => setMany(s.items, !allOn(s.items))} />
                    <button onClick={() => toggleCollapsed(secKey)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
                      {open ? <ChevronDown size={14} className="text-ink-faint" /> : <ChevronRight size={14} className="text-ink-faint" />}
                      {groupMode === 'label'
                        ? <Tag size={13} className={s.unlabeled ? 'text-ink-faint' : 'text-brand-ink'} />
                        : <Music2 size={13} className="text-ink-faint" />}
                      <span className="text-sm font-bold text-ink truncate">{s.name}</span>
                      {s.ready && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-success/10 text-success inline-flex items-center gap-1"><Star size={9} /> Ready</span>}
                      <span className="text-[11px] text-ink-faint tabular-nums">{s.items.length}</span>
                    </button>
                    <span className="text-xs font-semibold text-ink tabular-nums">{totalsLine(s.items)}</span>
                  </div>
                  {open && s.categories.map(c => {
                    const catKey = `c:${current.key}:${s.key}:${c.cat}`
                    const catOpen = !isCollapsed(catKey)
                    const single = c.cat === '__ALL__'
                    return (
                      <div key={c.cat} className="border-b border-divider last:border-0">
                        {!single && (
                          <div className="flex items-center gap-2 px-4 py-1.5 bg-page/20">
                            <Check4 checked={allOn(c.items)} onChange={() => setMany(c.items, !allOn(c.items))} />
                            <button onClick={() => toggleCollapsed(catKey)} className="flex items-center gap-1 min-w-0 flex-1 text-left">
                              {catOpen ? <ChevronDown size={11} className="text-ink-faint" /> : <ChevronRight size={11} className="text-ink-faint" />}
                              <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide truncate">{c.cat}</span>
                              <span className="text-[10px] text-ink-faint tabular-nums">{c.items.length}</span>
                            </button>
                            <span className="text-[11px] text-ink-muted tabular-nums">{totalsLine(c.items)}</span>
                          </div>
                        )}
                        {(single || catOpen) && <div className="divide-y divide-divider">{c.items.map(row)}</div>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* ── Artist cards ── */
        <>
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => setMany(activeItems, !allOn(activeItems))} className="text-xs font-semibold text-brand-ink hover:underline">
              {allOn(activeItems) ? 'Deselect all' : 'Select all staged'}
            </button>
            <span className="text-xs text-ink-faint">{activeCards.length} artist{activeCards.length === 1 ? '' : 's'} · {activeItems.length} item{activeItems.length === 1 ? '' : 's'}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {activeCards.map(c => <Card key={c.key} c={c} onOpen={() => setSelectedArtist(c.key)} onDefer={() => toggleDefer(c.key)} onFlag={() => flagArtist(c)} deferred={false} />)}
          </div>

          {deferredCards.length > 0 && (
            <div className="mt-6">
              <div className="flex items-baseline gap-3 mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Saved for later</h3>
                <span className="text-xs text-ink-muted tabular-nums">{deferredItems.length} item{deferredItems.length === 1 ? '' : 's'} · {totalsLine(deferredItems)}</span>
              </div>
              <p className="text-[11px] text-ink-faint mb-2">
                {activeCards.length === 0
                  ? 'Every staged artist is saved for later — nothing would be uploaded by “Done”. Un-save one to include it.'
                  : 'Still staged and still inspectable; “Done” skips them until you un-save.'}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {deferredCards.map(c => <Card key={c.key} c={c} onOpen={() => setSelectedArtist(c.key)} onDefer={() => toggleDefer(c.key)} onFlag={() => flagArtist(c)} deferred />)}
              </div>
            </div>
          )}
        </>
      )}

      {/* Selection bar — floating, so it never covers the last row of a list. */}
      {sel.size > 0 && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-1.5rem)] flex flex-wrap items-center justify-center gap-2.5 rounded-xl bg-card border border-rule shadow-modal px-4 py-3"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
          <span className="text-sm font-bold text-ink">{sel.size} selected</span>
          <span className="text-sm font-semibold text-success tabular-nums">{totalsLine(selRows)}</span>
          <span className="w-px h-5 bg-divider" />
          <button onClick={(e) => openLabelMenu(e, selRows.map(r => r.id), '')} className="btn-secondary !py-1.5 text-xs"><MoveRight size={12} /> Move to batch</button>
          <button onClick={bulkSetSong} disabled={busy} className="btn-secondary !py-1.5 text-xs"><Music2 size={12} /> Set song…</button>
          <button onClick={commitSelected} disabled={busy}
            title="Upload just these — the rest of the plan stays staged"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-success hover:opacity-90 disabled:opacity-40">
            <Upload size={12} /> {busy ? 'Uploading…' : `Upload ${sel.size}`}
          </button>
          <button onClick={() => unstage(selRows.map(r => r.id))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-danger border border-danger/30 hover:bg-danger/10">
            <X size={12} /> Un-stage
          </button>
          <button onClick={() => setSel(new Set())} className="text-xs font-semibold text-ink-muted hover:underline px-1">Cancel</button>
        </div>
      )}

      {undo && (
        <div className="fixed bottom-4 left-4 z-40 card px-4 py-2.5 shadow-elevated flex items-center gap-3">
          <span className="text-xs text-ink">{undo.text}</span>
          <button onClick={async () => { const u = undo; setUndo(null); try { await u.run() } catch { toast('Undo failed', 'error') } }}
            className="text-xs font-semibold text-brand-ink hover:underline inline-flex items-center gap-1"><Undo2 size={12} /> Undo</button>
        </div>
      )}

      {labelMenu && createPortal(
        <LabelMenu menu={labelMenu} labels={offeredLabels} onClose={() => setLabelMenu(null)}
          onPick={(l) => applyLabel(labelMenu.ids, l)} />, document.body)}

      {splitting && <SplitModal entry={splitting} artistNames={[...new Set(rows.map(r => r.artist).filter(Boolean))]} toast={toast}
        onClose={() => setSplitting(null)}
        onDone={() => { unstage([splitting.id]); setSplitting(null); load(true) }} />}

      {preview && createPortal(
        <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null) }}>
          <div className="card w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-divider">
              <span className="text-sm font-semibold text-ink truncate">{preview.name}</span>
              <button onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null) }} className="text-ink-faint hover:text-ink"><X size={18} /></button>
            </div>
            <iframe title="Invoice" src={preview.url} className="flex-1 w-full bg-page" />
          </div>
        </div>, document.body)}

      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={confirm?.onConfirm}
        title={confirm?.title} message={confirm?.message} />
    </div>
  )
}

const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const sortByDate = (items) => [...items].sort((a, b) =>
  String(b.payment_date || b.invoice_date || '').localeCompare(String(a.payment_date || a.invoice_date || '')))

function Stat({ label, value, extra }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">{label}</p>
      <p className="text-2xl font-bold text-ink tabular-nums mt-1">{value}{extra}</p>
    </div>
  )
}

// A 16px checkbox that stops the click reaching a collapsing header behind it.
function Check4({ checked, onChange }) {
  return <input type="checkbox" checked={checked} onChange={onChange} onClick={e => e.stopPropagation()} />
}

function Card({ c, deferred, onOpen, onDefer, onFlag }) {
  return (
    <div className={`card p-4 ${deferred ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-2">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left group">
          <span className="text-sm font-bold text-ink group-hover:text-brand-ink truncate block">{c.name}</span>
          <span className="text-[11px] text-ink-muted tabular-nums">
            {c.items.length} item{c.items.length === 1 ? '' : 's'} staged
            {c.unlabeled > 0 && <span className="text-warning font-semibold"> · {c.unlabeled} unlabeled</span>}
          </span>
        </button>
        {c.ready && <span title="Marked ready for planning" className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-success/10 text-success inline-flex items-center gap-1"><Star size={9} /> Ready</span>}
        <button onClick={onFlag} title={c.flag_reason || (c.flagged ? 'Flagged — click to clear' : 'Flag this artist')}
          className={c.flagged ? 'text-warning' : 'text-ink-faint hover:text-warning'}><Flag size={14} /></button>
        <button onClick={onDefer} title={deferred ? 'Include in the next upload' : 'Save for later — “Done” will skip this artist'}
          className={deferred ? 'text-brand-ink' : 'text-ink-faint hover:text-brand-ink'}><Bookmark size={14} fill={deferred ? 'currentColor' : 'none'} /></button>
        <button onClick={onOpen} className="text-ink-faint hover:text-brand-ink"><ChevronRight size={16} /></button>
      </div>
      <p className="mt-2 text-lg font-bold text-success tabular-nums">{moneyByCurrency(curTotals(c.items))}</p>
      {Object.keys(curTotals(c.items)).length > 1 && <p className="text-[11px] text-ink-faint tabular-nums">≈ {money(c.usd)}</p>}
      {c.flagged && c.flag_reason && <p className="mt-2 text-[11px] text-warning bg-warning/5 rounded px-2 py-1">{c.flag_reason}</p>}
    </div>
  )
}

function Row({ r, selected, focused, label, showSong, onSelect, onLabel, onClaim, onUnrecoup, onCobrand, onSplit, onFlag, onFile, onDelete, onRemove }) {
  const socials = socialsList(r.social_handles)
  const hasFile = !!(r.invoice_filename || r.receipt_filename)
  return (
    <div id={`plan-item-${r.id}`}
      className={`px-4 py-2 text-xs transition ${focused ? 'ring-2 ring-warning' : ''} ${selected ? 'bg-selected' : 'hover:bg-brand-500/5'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={selected} onChange={onSelect} />
        <span className="text-ink-muted w-20 flex-shrink-0 tabular-nums">{formatDate(r.payment_date || r.invoice_date)}</span>
        <BankEvidenceDot row={r} className="flex-shrink-0" />
        <span className="text-ink font-medium flex-1 min-w-[120px] truncate" title={STATE_LABEL[r.state]}>{r.payee || '—'}</span>
        {r.invoice_number && <span className="text-[10px] text-ink-faint flex-shrink-0">#{r.invoice_number}</span>}
        {showSong && r.song && <span className="text-[10px] px-1.5 py-0.5 rounded bg-elev text-ink-muted flex-shrink-0">{r.song}</span>}
        {r.category && <span className="text-[10px] px-1.5 py-0.5 rounded bg-elev text-ink-muted flex-shrink-0">{r.category}</span>}
        <button onClick={onLabel} title="Which upload batch does this belong to?"
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1 flex-shrink-0 ${label ? 'bg-brand-500/10 text-brand-ink' : 'bg-elev text-ink-faint hover:bg-brand-500/10'}`}>
          <Tag size={9} /> {label || 'Add batch'}
        </button>
        {socials.length > 0 && (
          <span title={socials.map(s => s.display).join(', ')} className="text-[10px] px-1.5 py-0.5 rounded bg-elev text-ink-muted flex-shrink-0">
            <AtSign size={9} className="inline" /> {socials[0].handle}{socials.length > 1 ? ` +${socials.length - 1}` : ''}
          </span>
        )}
        {r.cobrand && <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/10 text-info flex-shrink-0">Cobrand</span>}
        {/* Unpaid is a WARNING here, not a neutral fact: an unpaid cost can be
            staged but the bank cannot prove it yet. */}
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${r.payment_status === 'Paid' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
          {r.payment_status === 'Paid' ? 'Paid' : 'Unpaid'}
        </span>
        <span className="text-sm font-bold text-ink tabular-nums flex-shrink-0">
          {moneyOrig(r.amount, r.currency)}
          {r.currency !== 'USD' && <span className="text-[10px] font-normal text-ink-faint ml-1">≈ {money(r.amount_usd)}</span>}
        </span>
        <button onClick={onClaim} title="Upload just this one for recoupment, carrying its batch label"
          className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-elev text-ink-muted hover:bg-success/10 hover:text-success flex-shrink-0">UFR</button>
        <button onClick={onUnrecoup} title="Not recoupable — drops it from every recoupment surface" className="text-[10px] font-semibold text-ink-faint hover:text-danger flex-shrink-0">R−</button>
        <button onClick={onCobrand} title="Cobrand (forces category Marketing)" className="text-[10px] font-semibold text-ink-faint hover:text-brand-ink flex-shrink-0">CB</button>
        {hasFile
          ? <button onClick={onFile} title={r.invoice_filename || r.receipt_filename} className="text-ink-faint hover:text-brand-ink flex-shrink-0"><Paperclip size={12} /></button>
          : <span title="No invoice on file" className="text-ink-faint/40 flex-shrink-0"><Paperclip size={12} /></span>}
        <button onClick={onSplit} title="Split across artists" className="text-ink-faint hover:text-brand-ink flex-shrink-0"><Scissors size={12} /></button>
        <button onClick={onFlag} title={r.flag_reason || (r.flagged ? 'Flagged — click to clear' : 'Flag for review')}
          className={`flex-shrink-0 ${r.flagged ? 'text-warning' : 'text-ink-faint hover:text-warning'}`}><Flag size={12} /></button>
        <button onClick={onDelete} title="Delete (soft — restorable from the Ledger)" className="text-ink-faint hover:text-danger flex-shrink-0"><Trash2 size={12} /></button>
        <button onClick={onRemove} title="Un-stage — leaves the ledger alone" className="text-ink-faint hover:text-danger flex-shrink-0"><X size={13} /></button>
        <Link to={`/ledger?focus=${r.id}`} title="Open in the ledger" className="text-ink-faint hover:text-brand-ink flex-shrink-0"><ExternalLink size={12} /></Link>
      </div>
      {r.flagged && r.flag_reason && <p className="mt-1 ml-6 text-[11px] text-warning bg-warning/5 rounded px-2 py-1">{r.flag_reason}</p>}
    </div>
  )
}

// Anchored, portalled label picker: existing batches with a ✓, a new-batch
// input, and Clear. Portalled because the row it anchors to lives inside a
// scrolling, overflow-hidden card.
function LabelMenu({ menu, labels, onClose, onPick }) {
  const [draft, setDraft] = useState('')
  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div className="fixed z-[61] w-64 max-h-72 overflow-y-auto card shadow-modal py-1"
        style={{ top: menu.top, left: menu.left }}>
        {labels.map(l => (
          <button key={l} onClick={() => onPick(l)}
            className="w-full px-3 py-1.5 text-left text-xs text-ink hover:bg-brand-500/10 truncate flex items-center gap-1.5">
            {menu.current === l ? <Check size={11} className="text-success flex-shrink-0" /> : <span className="w-[11px] flex-shrink-0" />}
            {l}
          </button>
        ))}
        {labels.length > 0 && <div className="border-t border-divider my-1" />}
        <div className="px-2 py-1 flex items-center gap-1">
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) onPick(draft.trim()) }}
            placeholder="New batch…" className="input !py-1 text-xs flex-1" />
          <button disabled={!draft.trim()} onClick={() => onPick(draft.trim())} className="btn-secondary !py-1 !px-2 text-xs disabled:opacity-40"><Plus size={12} /></button>
        </div>
        <button onClick={() => onPick('')} className="w-full px-3 py-1.5 text-left text-xs text-ink-muted hover:bg-brand-500/10">Clear batch</button>
      </div>
    </>
  )
}

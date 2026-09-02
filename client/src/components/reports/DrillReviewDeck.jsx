// Review deck over the rows behind ONE P&L cell — the drill's list turned into
// one card at a time.
//
// The drill list is a fine place to answer three rows. It is a bad place to
// answer ninety: every row costs a hunt for its little "cat"/"artist"/"mo"
// buttons, a modal, a picker, an Apply. This is the same four actions with the
// hunting removed — → accept · ← skip · ⌫ undo · D dismiss · P document ·
// 1-9 pick a category · Esc close.
//
// THE SNAPSHOT RULE. `rows` is whatever the drill is SHOWING (filtered, sorted,
// capped), frozen at open. Every figure the deck states — the money bar, the
// weight on each card, the done panel — is reduced over that same array. Taking
// the denominator from the cell total instead would put "$12k of $188k" above a
// deck that only holds $61k of it, and the bar would never reach the end.
// Truncation is DISCLOSED on the card rather than papered over: past the
// server's 500-row render cap the deck is honestly working a subset, and says
// which subset and how much is outside it.
//
// WHY EVERY EDIT LANDS ON ACCEPT. Category, artist and reported month are all
// staged on the card and written together when you accept. The reference app
// applied the month immediately, which meant ⌫ could not reverse it — undo
// stepped the card back and left the month moved. One write point, one inverse:
// undo replays the exact opposite of what THIS card did, in reverse order, so
// the safety net covers everything the deck can do.
//
// The inverses (each is a real server call, not a local rollback):
//   category → recategorize back to `category_raw` (or `clear` when it had none)
//   artist   → set-artist back to `artist_raw` (null clears, which is correct)
//   month    → reassign-month back to the previous target; equal to the real
//              month, the endpoint deletes the override, which is also correct
//   dismiss  → dismiss/restore
//
// `_raw` and not the display value: the server has already run the category
// through catNameOf ("Uncategorized" for a NULL) and the artist through
// artistLabel (null for a placeholder), and restoring either of those writes a
// string the row never held.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Ban, Check, ChevronLeft, FileText, Undo2 } from 'lucide-react'
import api from '../../api'
import useCategories from '../../hooks/useCategories'
import useHotkeys from '../../hooks/useHotkeys'
import ReviewDeck from '../ReviewDeck'
import PayeeLink from '../PayeeLink'
import { money, moneyOrig } from '../../utils/money'
import { InlineDoc } from './DrillDocs'

const PREVIEW_KEY = 'reports:deck:preview'
const monthOf = (d) => String(d || '').slice(0, 7)
const same = (a, b) => String(a ?? '') === String(b ?? '')

export default function DrillReviewDeck({ open, rows, drill, pnl, poolSize = 0, capped = false, onClose, toast }) {
  const cats = useCategories()
  const isIncome = drill?.kind === 'income'

  // Usage-ranked, so the numbers printed in the picker and the 1-9 keys mean
  // the same thing here as they do in the statements deck. Stable sort keeps
  // the server's canonical order for anything unused.
  const options = useMemo(() => {
    const base = isIncome ? cats.income : cats.expense
    const usage = pnl?.category_usage
    if (!usage) return base
    return [...base].sort((a, b) => (usage[b] || 0) - (usage[a] || 0))
  }, [cats, isIncome, pnl])

  const [items, setItems] = useState(rows || [])
  const [index, setIndex] = useState(0)
  // Staging is DERIVED at render, not synced by an effect. An effect runs after
  // commit, so the first paint of every card showed the PREVIOUS card's picker
  // values and a "Will apply: …" line describing edits nobody had made. Keyed
  // to the card: no key means "whatever the row already says".
  const [staging, setStaging] = useState({ key: null, cat: '', artist: '', month: '' })
  const [history, setHistory] = useState([])
  // "kept" and "skipped" are not the same answer and the done panel should not
  // merge them: keeping is a verdict (I looked, it is right), skipping is the
  // absence of one (come back to this).
  const [stats, setStats] = useState({ recategorized: 0, 'artist set': 0, 'month moved': 0, dismissed: 0, kept: 0, skipped: 0 })
  const [busy, setBusy] = useState(false)
  const [changedUsd, setChangedUsd] = useState(0)
  const [previewOn, setPreviewOn] = useState(() => {
    try { return localStorage.getItem(PREVIEW_KEY) === '1' } catch { return false }
  })
  const dirtyRef = useRef(false)

  // Snapshot at open — never re-read from the drill while the deck is running,
  // or a card would change underneath the operator answering it.
  useEffect(() => {
    if (!open) return
    setItems(rows || [])
    setIndex(0); setHistory([]); setChangedUsd(0); setStaging({ key: null, cat: '', artist: '', month: '' })
    setStats({ recategorized: 0, 'artist set': 0, 'month moved': 0, dismissed: 0, kept: 0, skipped: 0 })
    dirtyRef.current = false
  }, [open]) // eslint-disable-line

  const item = items[index]
  const cardKey = item ? `${index}:${item.expense_id ?? `i${item.income_id}`}` : null
  const base = {
    cat: item?.category || '',
    artist: item?.artist || '',
    month: item?.report_month || monthOf(item?.date),
  }
  const live = staging.key === cardKey ? staging : base
  const cat = live.cat
  const artist = live.artist
  const month = live.month
  const stage = (patch) => setStaging({ key: cardKey, ...live, ...patch })
  const setCat = (v) => stage({ cat: v })
  const setArtist = (v) => stage({ artist: v })
  const setMonth = (v) => stage({ month: v })
  // Moving to another card drops the staging with it — the next card derives
  // its own from the row.
  const clearStaging = () => setStaging({ key: null, cat: '', artist: '', month: '' })

  useEffect(() => {
    try { localStorage.setItem(PREVIEW_KEY, previewOn ? '1' : '0') } catch { /* quota */ }
  }, [previewOn])

  const totalUsd = useMemo(() => items.reduce((s, r) => s + (Number(r?.usd) || 0), 0), [items])
  const doneUsd = useMemo(() => items.slice(0, index).reduce((s, r) => s + (Number(r?.usd) || 0), 0), [items, index])

  const bump = (key, n = 1) => setStats((s) => ({ ...s, [key]: Math.max(0, (s[key] || 0) + n) }))

  const advance = (entry) => {
    if (entry) setHistory((h) => [...h, entry].slice(-60))
    clearStaging()
    setIndex((i) => i + 1)
  }

  // ── Accept: write every staged change on this card, then move on ──────────
  // Writes are sequential and PARTIAL SUCCESS IS RECORDED. Three calls can land
  // one, two or three; a catch that recorded nothing would leave a category
  // change on the server with no way to reverse it from here. What landed goes
  // into history either way — and on a partial failure the card stays put so
  // the operator can see what still needs doing.
  const accept = async () => {
    if (!item || busy) return
    const ops = []
    if (!same(cat, item.category || '')) ops.push('category')
    if (!isIncome && item.expense_id && !same(artist, item.artist || '')) ops.push('artist')
    if (!same(month, item.report_month || monthOf(item.date))) ops.push('month')
    if (!ops.length) { bump('kept'); advance({ index, ops: [], row: item, verdict: 'kept' }); return }

    const id = item.expense_id ? { expense_id: item.expense_id } : { income_id: item.income_id }
    const done = []
    let failure = null
    setBusy(true)
    try {
      if (ops.includes('category')) {
        if (!cat) throw new Error('Pick a category first')
        await api.post('/reports/recategorize', { ...id, category: cat })
        done.push('category')
      }
      if (ops.includes('artist')) {
        await api.post('/reports/set-artist', { expense_id: item.expense_id, artist })
        done.push('artist')
      }
      if (ops.includes('month')) {
        await api.post('/reports/reassign-month', { ...id, target_month: month || null })
        done.push('month')
      }
    } catch (err) { failure = err }
    setBusy(false)

    if (done.length) {
      for (const o of done) bump(o === 'category' ? 'recategorized' : o === 'artist' ? 'artist set' : 'month moved')
      setChangedUsd((v) => v + (Number(item.usd) || 0))
      dirtyRef.current = true
      // Patch the snapshot for what LANDED, so stepping back onto this card
      // shows what the row now is rather than what was asked for.
      const patched = { ...item }
      if (done.includes('category')) patched.category = cat
      if (done.includes('artist')) patched.artist = artist
      if (done.includes('month')) {
        patched.report_month = month
        patched.moved_from = month === monthOf(item.date) ? null : monthOf(item.date)
      }
      setItems((xs) => xs.map((x, i) => (i === index ? patched : x)))
      const entry = { index, ops: done, row: item, prev: { category: item.category_raw ?? null, artist: item.artist_raw ?? null, month: item.report_month || monthOf(item.date) } }
      if (failure) setHistory((h) => [...h, entry].slice(-60)) // stay on the card
      else advance(entry)
    }
    if (failure) toast(failure.response?.data?.error || failure.message || 'Failed', 'error')
  }

  const skip = () => {
    if (!item || busy) return
    bump('skipped')
    advance({ index, ops: [], row: item, verdict: 'skipped' })
  }

  const dismiss = async () => {
    if (!item || busy) return
    const id = item.expense_id ? { expense_id: item.expense_id } : { income_id: item.income_id }
    setBusy(true)
    try {
      await api.post('/reports/dismiss', { ...id, cell_kind: isIncome ? 'income' : 'expense', cell_key: drill?.key || null })
      bump('dismissed')
      setChangedUsd((v) => v + (Number(item.usd) || 0))
      dirtyRef.current = true
      setItems((xs) => xs.map((x, i) => (i === index ? { ...x, dismissed: true } : x)))
      advance({ index, ops: ['dismiss'], row: item })
    } catch (err) { toast(err.response?.data?.error || 'Failed to dismiss', 'error') }
    finally { setBusy(false) }
  }

  // ── Undo: the exact inverse of the last card, in reverse order ────────────
  // Reversal is also sequential, and what has already been reversed is REMOVED
  // from the entry as it goes — otherwise a failure halfway through would make
  // the retry re-reverse the first half, and `dismiss/restore` 404s the second
  // time it is asked to restore the same row.
  const undo = async () => {
    if (busy || !history.length) return
    const last = history[history.length - 1]
    const row = last.row
    const id = row.expense_id ? { expense_id: row.expense_id } : { income_id: row.income_id }
    const remaining = [...last.ops].reverse()
    let failure = null
    setBusy(true)
    while (remaining.length) {
      const op = remaining[0]
      try {
        if (op === 'dismiss') await api.post('/reports/dismiss/restore', id)
        else if (op === 'month') await api.post('/reports/reassign-month', { ...id, target_month: last.prev.month || null })
        else if (op === 'artist') await api.post('/reports/set-artist', { expense_id: row.expense_id, artist: last.prev.artist || '' })
        else if (op === 'category') {
          if (last.prev.category) await api.post('/reports/recategorize', { ...id, category: last.prev.category })
          else await api.post('/reports/recategorize', { ...id, category: '', clear: true })
        }
      } catch (err) { failure = err; break }
      remaining.shift()
      bump(op === 'category' ? 'recategorized' : op === 'artist' ? 'artist set' : op === 'month' ? 'month moved' : 'dismissed', -1)
    }
    setBusy(false)

    if (failure) {
      // Keep the entry, minus what was already put back.
      setHistory((h) => [...h.slice(0, -1), { ...last, ops: [...remaining].reverse() }])
      toast(failure.response?.data?.error || 'Could not undo that', 'error')
      return
    }
    if (!last.ops.length) bump(last.verdict || 'skipped', -1)
    else setChangedUsd((v) => Math.max(0, v - (Number(row.usd) || 0)))
    setItems((xs) => xs.map((x, i) => (i === last.index ? row : x)))
    setHistory((h) => h.slice(0, -1))
    clearStaging()
    setIndex(last.index)
    if (last.ops.length) toast('Undone')
  }

  // Bubble-phase, and it excuses itself while a field has focus — the picker on
  // the card is a real <select>, and 1-9 must not fight its own type-ahead.
  // Escape belongs to ReviewDeck's capture-phase escape stack, not here.
  // `open ? … : {}` and not an `active` flag: this component stays mounted
  // across a close (ReviewDeck owns the open/closed render), and a live
  // ArrowRight after closing would accept a card nobody is looking at.
  // Enter is deliberately NOT bound — after clicking Skip that button holds
  // focus, and Enter would fire both the button and the hotkey.
  useHotkeys(open ? {
    ArrowRight: accept,
    ArrowLeft: skip,
    Backspace: undo,
    d: dismiss,
    D: dismiss,
    p: () => setPreviewOn((v) => !v),
    P: () => setPreviewOn((v) => !v),
    ...Object.fromEntries(options.slice(0, 9).map((c, i) => [String(i + 1), () => setCat(c)])),
  } : {}, [open, index, items, cat, artist, month, busy, history, options])

  const close = () => onClose(dirtyRef.current)

  if (!open) return null

  // What the deck is NOT covering. `poolSize` is every row in the cell (the
  // server's pre-cap count when it capped, otherwise what it returned); items
  // is what the drill was showing when the deck opened. Disclose the gap
  // rather than let the progress bar imply the cell is done.
  const outside = Math.max(0, poolSize - items.length)
  const weight = item && totalUsd ? Math.abs((Number(item.usd) || 0) / totalUsd) * 100 : 0
  const staged = item
    ? [
      !same(cat, item.category || '') ? `${item.category || 'no category'} → ${cat || 'none'}` : null,
      !isIncome && item.expense_id && !same(artist, item.artist || '') ? `artist ${item.artist || 'none'} → ${artist || 'none'}` : null,
      !same(month, item.report_month || monthOf(item.date)) ? `reported in ${month || monthOf(item.date)}` : null,
    ].filter(Boolean)
    : []

  return (
    <ReviewDeck
      open={open}
      title={`Review — ${drill?.label || drill?.key || 'cell'}`}
      sub={`${money(doneUsd)} of ${money(totalUsd)}`}
      items={items}
      index={index}
      stats={stats}
      doneNote={`${money(changedUsd)} of the ${money(totalUsd)} in this deck was changed.${outside > 0 ? ` ${outside} row${outside === 1 ? '' : 's'} in this cell were outside the deck and were not reviewed.` : ''}`}
      onClose={close}
    >
      {(r) => (
        <div className="card p-5 border-2 border-rule">
          {outside > 0 && (
            <p className="text-[11px] text-warning mb-2">
              Working the {items.length} row{items.length === 1 ? '' : 's'} on screen — {outside} more {outside === 1 ? 'is' : 'are'} in this cell,
              {capped ? ' past the 500-row render cap' : ' hidden by the drill filter'}, and {outside === 1 ? 'is' : 'are'} not in this deck.
            </p>
          )}

          <div className="flex items-start justify-between gap-3">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-elev text-ink-muted">
              currently {r.category || 'uncategorized'}
            </span>
            <span className="text-[11px] text-ink-faint tabular-nums">{r.date}</span>
          </div>

          <div className="text-3xl font-bold text-ink mt-1.5 tabular-nums">
            {money(r.usd)}
            {r.currency && r.currency !== 'USD' && <span className="text-sm font-semibold text-ink-muted"> · {moneyOrig(r.amount, r.currency)}</span>}
          </div>
          {/* Weight, so a card reads as "most of this line" or "a rounding
              error in it" without leaving the deck. Of the DECK, not of the
              cell — those differ the moment the drill is filtered, and the
              header's denominator is this one. */}
          {totalUsd !== 0 && (
            <p className="text-[11px] font-semibold text-ink-faint tabular-nums">
              {weight < 0.1 ? '<0.1' : weight.toFixed(1)}% of the {money(totalUsd)} in this deck
            </p>
          )}

          <p className="text-[15px] font-semibold text-ink mt-1 truncate"><PayeeLink payee={r.payee} /></p>
          <p className="text-xs text-ink-muted truncate">
            {[r.artist, r.song, r.invoice_number ? `inv ${r.invoice_number}` : null,
              r.evidence === 'invented' ? 'booked from a bank line — no document' : null,
              r.split_of ? 'one slice of a split payment' : null,
              r.moved_from ? `moved from ${r.moved_from}` : null].filter(Boolean).join(' · ') || '—'}
          </p>

          <div className="rounded-lg border border-rule bg-elev p-3 mt-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              Accept to keep — or change it here · 1-9 picks
            </p>
            <select className="input !py-1.5 text-sm" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
              <option value="">— no category —</option>
              {options.map((c, i) => <option key={c} value={c}>{i < 9 ? `${i + 1} · ` : ''}{c}</option>)}
            </select>
            <div className="flex flex-wrap gap-2">
              {!isIncome && r.expense_id && (
                <>
                  <input className="input !py-1.5 text-sm flex-1 min-w-[140px]" list="deck-artists" value={artist}
                    onChange={(e) => setArtist(e.target.value)} placeholder="Artist (blank clears)" aria-label="Artist" />
                  <datalist id="deck-artists">{(pnl?.artists || []).map((a) => <option key={a} value={a} />)}</datalist>
                </>
              )}
              <input type="month" className="input !py-1.5 text-sm w-40" value={month}
                onChange={(e) => setMonth(e.target.value)} aria-label="Reported in month" />
            </div>
            {staged.length > 0 && (
              <p className="text-[11px] font-semibold text-warning">Will apply: {staged.join(' · ')}</p>
            )}
            <p className="text-[10px] text-ink-faint">The month is report-only — the row keeps its real payment date.</p>
          </div>

          <div className="mt-3">
            <button className="text-[11px] font-semibold text-ink-muted hover:text-ink inline-flex items-center gap-1"
              onClick={() => setPreviewOn((v) => !v)}>
              <FileText size={12} /> {previewOn ? 'Hide document (P)' : `Show document (P)${r.docs?.length ? ` · ${r.docs.length}` : ''}`}
            </button>
            {previewOn && <div className="mt-2"><InlineDoc row={r} /></div>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
            <button className="btn-secondary !py-1.5 inline-flex items-center gap-1" onClick={skip} disabled={busy}><ChevronLeft size={14} /> Skip</button>
            <button className="text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-40 inline-flex items-center gap-1"
              onClick={undo} disabled={busy || !history.length}><Undo2 size={14} /> Undo</button>
            <button className="text-xs font-semibold text-ink-muted hover:text-danger inline-flex items-center gap-1"
              onClick={dismiss} disabled={busy}><Ban size={14} /> Dismiss</button>
            <button className="btn-primary !py-1.5 inline-flex items-center gap-1" onClick={accept} disabled={busy}>
              <Check size={14} /> {busy ? 'Working…' : staged.length ? 'Apply' : 'Keep'}
            </button>
          </div>
          <p className="mt-3 text-[11px] text-ink-faint leading-relaxed">
            → accept · ← skip · ⌫ undo · <b>D</b> dismiss · <b>P</b> document · <b>1-9</b> pick a category · Esc close
          </p>
        </div>
      )}
    </ReviewDeck>
  )
}

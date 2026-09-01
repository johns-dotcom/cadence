// Swipe deck over open bank rows — one card at a time, queue-agnostic (the
// statement detail and the Bank Matching page both feed it `items`).
//
// The card asks the sharpest question it can about THIS row:
//   match   — a top suggestion at ≥0.85 whose invoice isn't already claimed
//   choose  — several plausible candidates, none decisive: which one?
//   rematch — a booked row whose real invoice has since arrived
//   book    — no invoice is coming; which category (and which artist)?
//   income  — a credit, and not a reversal (money back is never revenue)
//
// Keys: → accept · ← skip · ⌫ undo · D dismiss · F flag · N no-invoice ·
//       S search the ledger · B force book over a match · 1-9 pick a category
//       · Esc close. The hint line names all of them — a key nobody can see
//       is a key nobody uses.
//
// UNDO is per-kind, not a generic "go back": every accept has a server
// inverse, and the deck applies THAT inverse. A deck with no undo makes the
// fastest surface in the app the one where a mistake costs the most.
//
// Two bugs the reference app shipped, guarded here:
//  * POINTER CAPTURE: capturing on pointerdown swallows child clicks, so
//    buttons/selects go dead for mouse users — bail when the press started
//    on a control.
//  * 409 SELF-HEAL: suggestions are computed when a card is shown, so two
//    duplicate rows can carry the same 100% suggestion; accepting the first
//    claims the invoice and the second would dead-end on a 409 alert.
//    Instead: add the target to `claimed`, re-render — the card visibly
//    flips to its book fallback. No alert.

import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../../api'
import ReviewDeck from '../ReviewDeck'
import useCategories from '../../hooks/useCategories'
import { formatDate } from '../../utils/dates'

const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`

export default function StatementReviewDeck({ open, items: rawItems, onClose, onChanged, toast, artists = [] }) {
  const cats = useCategories()
  // Skipped rows are DEMOTED, not dropped: a skip means "not now", and a deck
  // that re-offers them immediately is a deck nobody finishes.
  const [skipped, setSkipped] = useState(() => new Set())
  const items = useMemo(() => {
    const rank = (t) => {
      if (skipped.has(t.id)) return 3
      if (t.direction === 'debit' && (t.suggestions?.length || t.disposition !== 'open')) return 0
      if (t.suggested_category || t.suggested_income_type) return 1
      return 2
    }
    return [...rawItems].sort((a, b) => rank(a) - rank(b))
  }, [rawItems, skipped])

  const [index, setIndex] = useState(0)
  const [stats, setStats] = useState({ matched: 0, booked: 0, dismissed: 0, skipped: 0, flagged: 0, answered: 0 })
  const [claimed] = useState(() => new Set())
  const [sugg, setSugg] = useState({}) // txnId -> suggestions[]
  const [pick, setPick] = useState('') // the editable select value for THIS card
  const [artist, setArtist] = useState('')
  const [forceBook, setForceBook] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dx, setDx] = useState(0)
  const [history, setHistory] = useState([])   // [{ kind, item, ...payload }]
  const [search, setSearch] = useState(null)   // null | { q, results }
  const dragRef = useRef(null)

  const item = items[index]
  const isCredit = item?.direction === 'credit'
  const list = isCredit ? cats.income : cats.expense

  // Lazy suggestions: fetch for the current debit card (and prefetch next).
  useEffect(() => {
    if (!open) return
    for (const t of [items[index], items[index + 1]]) {
      if (t && t.direction === 'debit' && sugg[t.id] === undefined) {
        setSugg((s) => ({ ...s, [t.id]: null }))
        api.get(`/bank-statements/txns/${t.id}/suggestions`)
          .then((r) => setSugg((s) => ({ ...s, [t.id]: r.data.data || [] })))
          .catch(() => setSugg((s) => ({ ...s, [t.id]: [] })))
      }
    }
  }, [open, index, items]) // eslint-disable-line

  // Reset the card-local state when the card changes.
  useEffect(() => {
    if (!item) return
    setPick(item.suggested_category || item.exp_category || item.suggested_income_type || (isCredit ? 'Other Income' : 'Other'))
    setArtist(item.exp_artist || '')
    setForceBook(false)
    setSearch(null)
    setDx(0)
  }, [index, open]) // eslint-disable-line

  const cands = (item ? sugg[item.id] : null) || []
  const live = cands.filter((x) => !claimed.has(x.expense_id))
  const primary = useMemo(() => {
    if (!item) return null
    // Re-review mode feeds ANSWERED rows through the deck. A row already tied
    // to a real invoice, or already set aside, has nothing left to accept —
    // offering "book" there would invent a second entry for money that is
    // already recorded. The card says so and the accept is a no-op advance.
    if (item.dismissed || item.matched_income_id
      || (item.matched_expense_id && !item.booked && item.match_method !== 'created' && item.exp_source !== 'bank_statement')) {
      return { kind: 'keep' }
    }
    if (item.direction === 'credit') return { kind: 'income' }
    // A booked row already carries an answer; the only sharper question is
    // whether its real invoice has arrived.
    const alreadyBooked = item.disposition === 'booked' || item.booked
    if (!forceBook && live[0] && live[0].score >= 0.85) return { kind: alreadyBooked ? 'rematch' : 'match', target: live[0] }
    if (!forceBook && !alreadyBooked && live.length > 1) return { kind: 'choose', target: live[0] }
    return { kind: alreadyBooked ? 'no-invoice' : 'book' }
  }, [item, sugg, isCredit, claimed, forceBook]) // eslint-disable-line

  const advance = (key, entry) => {
    setStats((s) => ({ ...s, [key]: (s[key] || 0) + 1 }))
    if (entry) setHistory((h) => [...h, entry].slice(-40))
    setIndex((i) => i + 1)
  }

  const accept = async (targetId) => {
    if (!item || busy) return
    if (primary.kind === 'keep') { advance('skipped'); return }
    setBusy(true)
    try {
      if (primary.kind === 'match' || primary.kind === 'choose') {
        const expenseId = targetId || primary.target.expense_id
        try {
          await api.post(`/bank-statements/txns/${item.id}/match`, { expense_id: expenseId })
          claimed.add(expenseId)
          advance('matched', { kind: 'match', item, expense_id: expenseId })
        } catch (err) {
          if (err.response?.status === 409) {
            // Self-heal: claim it, re-render — the card flips to book-as.
            claimed.add(expenseId)
            setSugg((s) => ({ ...s })) // re-render
          } else if (err.response?.data?.prepayment_possible) {
            if (window.confirm(`${err.response.data.error}\n\nRecord it anyway?`)) {
              await api.post(`/bank-statements/txns/${item.id}/match`, { expense_id: expenseId, allow_prepayment: true })
              claimed.add(expenseId)
              advance('matched', { kind: 'match', item, expense_id: expenseId })
            }
          } else throw err
        }
      } else if (primary.kind === 'rematch') {
        const expenseId = targetId || primary.target.expense_id
        await api.post(`/bank-matching/tx/${item.id}/rematch`, { expense_id: expenseId })
        claimed.add(expenseId)
        advance('matched', { kind: 'rematch', item })
      } else if (primary.kind === 'income') {
        const { data } = await api.post(`/bank-statements/txns/${item.id}/book-income`, { income_type: pick })
        advance('booked', { kind: 'income', item, income_id: data.data?.income_id })
      } else if (primary.kind === 'no-invoice') {
        await api.post(`/bank-matching/tx/${item.id}/no-invoice`, {})
        advance('answered', { kind: 'no-invoice', item })
      } else {
        await api.post(`/bank-statements/txns/${item.id}/book`, { category: pick, artist: artist || null })
        advance('booked', { kind: 'book', item })
      }
    } catch (err) {
      toast(err.response?.data?.error || 'Failed', 'error')
    } finally { setBusy(false) }
  }

  const dismiss = async () => {
    if (!item || busy) return
    setBusy(true)
    try {
      // Dismissing a card that carried a suggestion is a "no" to THAT pairing.
      // Recording it is what stops the matcher offering it again next month.
      await api.post(`/bank-statements/txns/${item.id}/dismiss`, {
        rejected_expense_id: live[0]?.expense_id || undefined,
      })
      advance('dismissed', { kind: 'dismiss', item })
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(false) }
  }

  const flag = async () => {
    if (!item || busy) return
    try {
      await api.post(`/bank-matching/tx/${item.id}/flag`, { flagged: !item.flagged })
      setStats((s) => ({ ...s, flagged: s.flagged + 1 }))
      item.flagged = !item.flagged
      setSugg((s) => ({ ...s })) // re-render
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const noInvoice = async () => {
    if (!item || busy) return
    if (item.disposition === 'open' && !pick) { toast('Pick a category first', 'error'); return }
    setBusy(true)
    try {
      await api.post(`/bank-matching/tx/${item.id}/no-invoice`, item.disposition === 'open' ? { category: pick, artist: artist || null, confirm_new: true } : {})
      advance('answered', { kind: 'no-invoice-book', item, booked: item.disposition === 'open' })
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(false) }
  }

  // ── Undo: the inverse of what was actually done ────────────────────────
  const undo = async () => {
    if (busy || !history.length) return
    const last = history[history.length - 1]
    setBusy(true)
    try {
      if (last.kind === 'match') { await api.post(`/bank-statements/txns/${last.item.id}/unmatch`, {}); claimed.delete(last.expense_id) }
      else if (last.kind === 'rematch') await api.post(`/bank-matching/tx/${last.item.id}/unrematch`, {})
      else if (last.kind === 'book') await api.post(`/bank-statements/txns/${last.item.id}/unbook`, {})
      else if (last.kind === 'income') await api.post(`/bank-statements/txns/${last.item.id}/unbook-income`, {})
      else if (last.kind === 'dismiss') await api.post(`/bank-statements/txns/${last.item.id}/restore`, {})
      else if (last.kind === 'no-invoice') await api.post(`/bank-matching/tx/${last.item.id}/no-invoice`, { undo: true })
      else if (last.kind === 'no-invoice-book') {
        await api.post(`/bank-matching/tx/${last.item.id}/no-invoice`, { undo: true })
        if (last.booked) await api.post(`/bank-statements/txns/${last.item.id}/unbook`, {}).catch(() => {})
      }
      setHistory((h) => h.slice(0, -1))
      setIndex((i) => Math.max(0, i - 1))
      setStats((s) => {
        const key = { match: 'matched', rematch: 'matched', book: 'booked', income: 'booked', dismiss: 'dismissed' }[last.kind] || 'answered'
        return { ...s, [key]: Math.max(0, s[key] - 1) }
      })
      toast('Undone')
    } catch (err) { toast(err.response?.data?.error || 'Could not undo that', 'error') }
    finally { setBusy(false) }
  }

  const skip = () => {
    if (!item) return
    setSkipped((s) => new Set(s).add(item.id))
    advance('skipped')
  }

  // ── Inline ledger search ───────────────────────────────────────────────
  const runSearch = async (q) => {
    setSearch({ q, results: search?.results || [] })
    if (!q.trim()) return
    try {
      const { data } = await api.get('/bank-statements/ledger-search', { params: { q } })
      setSearch({ q, results: data.data || [] })
    } catch { setSearch({ q, results: [] }) }
  }

  // Keyboard — no-op while typing in a field.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
      if (e.key === 'ArrowRight') { e.preventDefault(); accept() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); skip() }
      else if (e.key === 'Backspace') { e.preventDefault(); undo() }
      else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); dismiss() }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); flag() }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); noInvoice() }
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setForceBook((v) => !v) }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); setSearch((s) => (s ? null : { q: '', results: [] })) }
      else if (/^[1-9]$/.test(e.key)) {
        const c = list[Number(e.key) - 1]
        if (c) { e.preventDefault(); setPick(c) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // fresh closure every render — accept/dismiss capture current card

  const onPointerDown = (e) => {
    // THE guard: capturing on a control swallows its click.
    if (e.target.closest('button, select, option, a, input, label')) return
    dragRef.current = { startX: e.clientX, id: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => { if (dragRef.current) setDx(e.clientX - dragRef.current.startX) }
  const onPointerUp = () => {
    if (!dragRef.current) return
    const final = dx
    dragRef.current = null
    setDx(0)
    if (final > 120) accept()
    else if (final < -120) skip()
  }

  const close = () => { onClose(); if (stats.matched + stats.booked + stats.dismissed + stats.answered > 0) onChanged() }

  const HEAD = {
    match: 'Swipe right to match', choose: 'Which invoice is this?', rematch: 'The real invoice arrived — swap it in',
    book: 'Swipe right to book as', income: 'Book this money in as', 'no-invoice': 'Confirm no invoice is coming',
    keep: 'Already answered — keep it as it is',
  }

  return (
    <ReviewDeck open={open} title="Review open items" items={items} index={index} stats={stats} onClose={close}>
      {(t) => (
        <div
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          style={{ transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transition: dx === 0 ? 'transform 150ms' : 'none', touchAction: 'pan-y' }}
          className="select-none"
        >
          <div className={`card p-5 border-2 ${dx > 60 ? 'border-success/50' : dx < -60 ? 'border-rule' : 'border-rule'}`}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-bold text-ink truncate">
                {t.flagged ? '⚑ ' : ''}{t.exp_payee || t.vendor_override || t.payee_guess || t.description || '—'}
              </p>
              <p className={`font-bold tabular-nums whitespace-nowrap ${t.direction === 'credit' ? 'text-info' : 'text-ink'}`}>
                {t.direction === 'credit' ? '+' : ''}{money(t.amount, t.currency)}
              </p>
            </div>
            <p className="text-xs text-ink-muted mb-3">
              {formatDate(t.txn_date)}{t.account ? ` · ${t.account}` : ''}{t.payee_email ? ` · ${t.payee_email}` : ''}
              {t.description && t.description !== t.payee_guess ? ` · ${t.description}` : ''}
              {t.vendor_hint && !t.exp_payee ? ` · ${t.vendor_hint.source}: ${t.vendor_hint.name}` : ''}
            </p>

            <div className="rounded-lg border border-rule bg-elev px-3 py-2 mb-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted mb-1">
                {HEAD[primary?.kind] || 'Answer this line'}
                {(primary?.kind === 'book' || primary?.kind === 'income') && (t.suggested_category || t.suggested_income_type) ? ' (suggested)' : ''}
                {(primary?.kind === 'book' || primary?.kind === 'income') ? ' — 1-9 picks' : ''}
              </p>

              {primary?.kind === 'match' || primary?.kind === 'rematch' ? (
                <p className="text-sm text-ink">
                  {primary.target.payee}{primary.target.invoice_number ? ` · #${primary.target.invoice_number}` : ''} — {money(primary.target.amount, primary.target.currency)}
                  <span className="text-xs text-ink-muted"> ({Math.round(primary.target.score * 100)}% · {primary.target.method})</span>
                </p>
              ) : primary?.kind === 'choose' ? (
                <div className="space-y-1">
                  {live.slice(0, 3).map((c) => (
                    <button key={c.expense_id} onClick={() => accept(c.expense_id)} disabled={busy}
                      className="w-full flex items-center justify-between gap-2 text-left rounded-lg border border-rule px-2.5 py-1.5 hover:border-brand-400 hover:bg-brand-500/10">
                      <span className="text-sm text-ink truncate">{c.payee}{c.invoice_number ? ` · #${c.invoice_number}` : ''}</span>
                      <span className="text-xs text-ink-muted whitespace-nowrap">{money(c.amount, c.currency)} · {Math.round(c.score * 100)}%</span>
                    </button>
                  ))}
                </div>
              ) : primary?.kind === 'no-invoice' ? (
                <p className="text-sm text-ink">
                  Booked as {t.exp_category || 'uncategorised'}. Accepting records that no document is coming, so it stops counting as unfinished.
                </p>
              ) : primary?.kind === 'keep' ? (
                <p className="text-sm text-ink">
                  {t.dismissed ? `Set aside${t.dismissed_reason ? ` (${t.dismissed_reason})` : ''}.` : `Matched to ${t.exp_payee || 'an invoice'}.`}
                  {' '}Accepting moves on and changes nothing. Use ⌫ to reopen the last decision, or D to set it aside.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <select className="input !py-1 text-sm flex-1 min-w-[150px]" value={pick} onChange={(e) => setPick(e.target.value)}>
                    {list.map((c, i) => <option key={c} value={c}>{i < 9 ? `${i + 1} · ` : ''}{c}</option>)}
                  </select>
                  {!isCredit && (
                    <select className="input !py-1 text-sm w-40" value={artist} onChange={(e) => setArtist(e.target.value)}>
                      <option value="">artist…</option>
                      {artists.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  )}
                </div>
              )}
              {live.length > 0 && (primary?.kind === 'match' || primary?.kind === 'rematch') && (
                <button className="mt-1.5 text-[11px] text-ink-muted underline" onClick={() => setForceBook((v) => !v)}>
                  {forceBook ? 'Use the match instead' : 'B · book it instead of matching'}
                </button>
              )}
            </div>

            {search && (
              <div className="rounded-lg border border-rule px-3 py-2 mb-3">
                <input autoFocus className="input !py-1 text-sm" placeholder="Search the ledger…" value={search.q} onChange={(e) => runSearch(e.target.value)} />
                <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
                  {search.results.map((r) => (
                    <button key={r.id} onClick={() => accept(r.id)} disabled={busy}
                      className="w-full flex items-center justify-between gap-2 text-left rounded-lg border border-rule px-2.5 py-1.5 hover:border-brand-400">
                      <span className="text-sm text-ink truncate">
                        {r.payee}{r.invoice_number ? ` · #${r.invoice_number}` : ''}
                        {r.partially_settled && <span className="text-[11px] text-warning"> · {r.remaining} left</span>}
                      </span>
                      <span className="text-xs text-ink-muted whitespace-nowrap">{money(r.family_amount, r.currency)}</span>
                    </button>
                  ))}
                  {search.q.trim() && !search.results.length && <p className="text-xs text-ink-muted">Nothing matching.</p>}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <button className="btn-secondary !py-1.5" onClick={skip} disabled={busy}>← Skip</button>
              <button className="text-ink-muted hover:text-ink font-semibold disabled:opacity-40" onClick={undo} disabled={busy || !history.length}>⌫ Undo</button>
              <button className="text-ink-muted hover:text-danger font-semibold" onClick={dismiss} disabled={busy}>D · Dismiss</button>
              <button className="btn-primary !py-1.5" onClick={() => accept()} disabled={busy}>
                {busy ? '…' : primary?.kind === 'match' ? 'Match →' : primary?.kind === 'rematch' ? 'Rematch →'
                  : primary?.kind === 'no-invoice' ? 'Confirm →' : primary?.kind === 'keep' ? 'Keep →' : 'Book →'}
              </button>
            </div>
            <p className="mt-3 text-[11px] text-ink-faint leading-relaxed">
              → accept · ← skip · ⌫ undo · <b>D</b> dismiss · <b>F</b> {t.flagged ? 'unflag' : 'flag'} · <b>N</b> no invoice coming ·
              {' '}<b>S</b> search the ledger · <b>B</b> book over a match · <b>1-9</b> pick a category · Esc close
            </p>
          </div>
        </div>
      )}
    </ReviewDeck>
  )
}

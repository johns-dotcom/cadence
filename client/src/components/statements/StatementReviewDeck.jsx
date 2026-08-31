// Swipe deck over open bank rows — one card at a time, queue-agnostic (the
// statement detail and the Bank Matching page both feed it `items`).
//
// Primary action per card: the top match suggestion when its score ≥ 0.85
// AND its invoice isn't already claimed this run; else book-as (debit →
// suggested category, credit → suggested income type), select editable on
// the card. Accept = swipe right / →; skip = left / ←; D dismiss; 1-9 pick
// from the category list (position-indexed — the list ORDER is load-bearing);
// Esc closes.
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

export default function StatementReviewDeck({ open, items: rawItems, onClose, onChanged, toast }) {
  const cats = useCategories()
  // Pre-tagged rows first (they have a one-keystroke answer), then the rest.
  const items = useMemo(() => {
    const tagged = rawItems.filter((t) => t.suggested_category || t.suggested_income_type)
    const rest = rawItems.filter((t) => !t.suggested_category && !t.suggested_income_type)
    return [...tagged, ...rest]
  }, [rawItems])

  const [index, setIndex] = useState(0)
  const [stats, setStats] = useState({ matched: 0, booked: 0, dismissed: 0, skipped: 0 })
  const [claimed] = useState(() => new Set())
  const [sugg, setSugg] = useState({}) // txnId -> suggestions[]
  const [pick, setPick] = useState('') // the editable select value for THIS card
  const [busy, setBusy] = useState(false)
  const [dx, setDx] = useState(0)
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

  // Reset the card-local select when the card changes.
  useEffect(() => {
    if (!item) return
    setPick(item.suggested_category || item.suggested_income_type || (isCredit ? 'Other Income' : 'Other'))
    setDx(0)
  }, [index, open]) // eslint-disable-line

  const primary = useMemo(() => {
    if (!item) return null
    const top = (sugg[item.id] || []).find((x) => !claimed.has(x.expense_id))
    if (item.direction === 'debit' && top && top.score >= 0.85) return { kind: 'match', target: top }
    return { kind: isCredit ? 'book-income' : 'book' }
  }, [item, sugg, isCredit, claimed, pick])

  const advance = (key) => {
    setStats((s) => ({ ...s, [key]: s[key] + 1 }))
    setIndex((i) => i + 1)
  }

  const accept = async () => {
    if (!item || busy) return
    setBusy(true)
    try {
      if (primary.kind === 'match') {
        try {
          await api.post(`/bank-statements/txns/${item.id}/match`, { expense_id: primary.target.expense_id })
          claimed.add(primary.target.expense_id)
          advance('matched')
        } catch (err) {
          if (err.response?.status === 409) {
            // Self-heal: claim it, re-render — the card flips to book-as.
            claimed.add(primary.target.expense_id)
            setSugg((s) => ({ ...s })) // re-render
          } else throw err
        }
      } else if (primary.kind === 'book-income') {
        await api.post(`/bank-statements/txns/${item.id}/book-income`, { income_type: pick })
        advance('booked')
      } else {
        await api.post(`/bank-statements/txns/${item.id}/book`, { category: pick })
        advance('booked')
      }
    } catch (err) {
      toast(err.response?.data?.error || 'Failed', 'error')
    } finally { setBusy(false) }
  }

  const dismiss = async () => {
    if (!item || busy) return
    setBusy(true)
    try { await api.post(`/bank-statements/txns/${item.id}/dismiss`, {}); advance('dismissed') }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(false) }
  }

  // Keyboard — no-op while typing in a field.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
      if (e.key === 'ArrowRight') { e.preventDefault(); accept() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); advance('skipped') }
      else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); dismiss() }
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
    if (e.target.closest('button, select, option, a, input')) return
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
    else if (final < -120) advance('skipped')
  }

  const close = () => { onClose(); if (stats.matched + stats.booked + stats.dismissed > 0) onChanged() }

  return (
    <ReviewDeck open={open} title="Review open items" items={items} index={index} stats={stats} onClose={close}>
      {(t) => {
        const top = (sugg[t.id] || []).find((x) => !claimed.has(x.expense_id))
        const showMatch = t.direction === 'debit' && top && top.score >= 0.85
        return (
          <div
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            style={{ transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transition: dx === 0 ? 'transform 150ms' : 'none', touchAction: 'pan-y' }}
            className="select-none"
          >
            <div className={`card p-5 border-2 ${dx > 60 ? 'border-emerald-300' : dx < -60 ? 'border-gray-300' : 'border-rule'}`}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-bold text-ink truncate">{t.payee_guess || t.description || '—'}</p>
                <p className={`font-bold tabular-nums whitespace-nowrap ${t.direction === 'credit' ? 'text-violet-600' : 'text-ink'}`}>
                  {t.direction === 'credit' ? '+' : ''}{money(t.amount, t.currency)}
                </p>
              </div>
              <p className="text-xs text-gray-400 mb-3">{formatDate(t.txn_date)}{t.payee_email ? ` · ${t.payee_email}` : ''}{t.description && t.description !== t.payee_guess ? ` · ${t.description}` : ''}</p>

              {showMatch ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Swipe right to match</p>
                  <p className="text-sm text-ink">{top.payee}{top.invoice_number ? ` · #${top.invoice_number}` : ''} — {money(top.amount, top.currency)} <span className="text-xs text-gray-400">({Math.round(top.score * 100)}%)</span></p>
                </div>
              ) : (
                <div className="rounded-lg border border-rule bg-page/60 px-3 py-2 mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    Swipe right to book as{(t.suggested_category || t.suggested_income_type) ? ' (suggested)' : ''} — 1-9 picks
                  </p>
                  <select className="input !py-1 mt-1 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
                    {list.map((c, i) => <option key={c} value={c}>{i < 9 ? `${i + 1} · ` : ''}{c}</option>)}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <button className="btn-secondary !py-1.5" onClick={() => advance('skipped')} disabled={busy}>← Skip</button>
                <button className="text-gray-400 hover:text-rose-600 font-semibold" onClick={dismiss} disabled={busy}>D · Dismiss</button>
                <button className="btn-primary !py-1.5" onClick={accept} disabled={busy}>{busy ? '…' : showMatch ? 'Match →' : 'Book →'}</button>
              </div>
            </div>
          </div>
        )
      }}
    </ReviewDeck>
  )
}

import { useEffect, useState } from 'react'
import { ShieldCheck, FileText, AlertTriangle, ExternalLink } from 'lucide-react'
import api from '../api'
import ReviewDeck from './ReviewDeck'

// The SECOND review on Approvals: is this W9 signed and dated? Ported from
// boom-dashboard's W9ReviewDeck onto cadence's ReviewDeck shell.
//
// ── One card per DOCUMENT, not per invoice ──────────────────────────────────
// The server (GET /ledger/w9-reviews) groups pending invoices under the W9
// that covers them (alias-aware owner resolution), so answering once clears
// every invoice riding on that document. A new upload is a new entry and
// comes back unreviewed — the behaviour you want from a document attestation.
//
// ── The answer is PRE-FILLED from the scan ──────────────────────────────────
// The AI already reads w9_signed / w9_dated on every W9. The server records
// whether the reviewer ACCEPTED the pre-fill or changed it, so the record can
// still tell "confirmed what the scan said" from "looked and decided".
//
// It does NOT gate approval — the answer is recorded and flagged, never a hold.

const money = (a, c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(a || 0)

export default function W9ReviewDeck({ items = [], onReviewed, onClose }) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState({}) // { [entryId]: bool } — in-flight overrides
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(0)
  const [skipped, setSkipped] = useState(0)

  const card = items[index]
  // The pre-fill: what the scan read, unless the reviewer changed it on this
  // card. undefined when there is no scan — then nothing is pre-selected and
  // the reviewer answers from the document.
  const scanSays = card?.scan ? (card.scan.signed === true && card.scan.dated === true) : undefined
  const current = card && answers[card.entry_id] !== undefined ? answers[card.entry_id] : scanSays

  const openFile = async () => {
    try { const { data } = await api.get(`/ledger/entries/${card.entry_id}/file/w9`); window.open(data.data.url, '_blank', 'noopener') }
    catch { setErr('Could not open the W-9') }
  }

  const skip = () => { setSkipped(n => n + 1); setIndex(i => i + 1); setErr('') }
  const submit = async (value) => {
    if (!card || typeof value !== 'boolean') return
    setBusy(true); setErr('')
    try {
      await api.post(`/ledger/w9-reviews/${card.entry_id}`, {
        signed_and_dated: value,
        prefilled: scanSays !== undefined,
        // Accepted only when the scan offered an answer AND the reviewer kept it.
        accepted_prefill: scanSays !== undefined && value === scanSays,
      })
      setDone(n => n + 1)
      onReviewed?.(card.entry_id, value)
      setIndex(i => i + 1)
    } catch (e) {
      setErr(e.response?.data?.error || e.message)
    } finally { setBusy(false) }
  }

  // Y / N answer, S skip — while the deck is open. Enter records the current
  // answer. useEscapeStack (via ReviewDeck) already owns Escape.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey || busy || !card) return
      if (e.key === 'y' || e.key === 'Y') setAnswers(a => ({ ...a, [card.entry_id]: true }))
      else if (e.key === 'n' || e.key === 'N') setAnswers(a => ({ ...a, [card.entry_id]: false }))
      else if (e.key === 's' || e.key === 'S') skip()
      else if (e.key === 'Enter' && current !== undefined) submit(current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line

  return (
    <ReviewDeck open title="W-9 review" items={items} index={index} stats={{ reviewed: done, skipped }} onClose={onClose}>
      {(c) => (
        <div>
          <div className="flex items-center gap-2 pb-3 border-b border-rule">
            <ShieldCheck size={16} className="text-ink-faint flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-bold text-ink truncate">{c.payee}</div>
              <div className="text-[11px] text-ink-faint truncate">{c.w9_filename || 'W-9 on file'}</div>
            </div>
            <button type="button" onClick={openFile}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-brand-ink hover:underline flex-shrink-0">
              <ExternalLink size={11} /> Open W-9
            </button>
          </div>

          {/* What this document is covering — the point of reviewing the
              DOCUMENT once is that it is usually more than one invoice. */}
          <div className="border border-rule rounded-lg p-2.5 my-3">
            <div className="text-[10px] font-bold text-ink-faint uppercase tracking-wider mb-1.5">
              Covers {c.invoices.length} pending invoice{c.invoices.length === 1 ? '' : 's'}
            </div>
            {c.invoices.slice(0, 4).map(i => (
              <div key={i.id} className="flex items-center gap-2 text-[12px] text-ink-muted py-0.5">
                <FileText size={11} className="text-ink-faint flex-shrink-0" />
                <span className="truncate">{i.invoice_number || `#${i.id}`}</span>
                <span className="ml-auto tabular-nums">{money(i.amount, i.currency)}</span>
              </div>
            ))}
            {c.invoices.length > 4 && <div className="text-[11px] text-ink-faint pt-0.5">and {c.invoices.length - 4} more</div>}
          </div>

          {/* What the scan read — shown because the answer below is pre-filled
              from it; hiding the basis of a pre-selected answer would be worse
              than not pre-selecting at all. */}
          {c.scan && (
            <div className="border border-rule rounded-lg p-2.5 mb-3 bg-page/60">
              <div className="text-[10px] font-bold text-ink-faint uppercase tracking-wider mb-1.5">The scan read</div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                <span>Form: <strong>{c.scan.form_type || 'unknown'}</strong></span>
                <span>Signed: <strong className={c.scan.signed ? 'text-success' : 'text-danger'}>{c.scan.signed ? 'yes' : 'no'}</strong></span>
                <span>Dated: <strong className={c.scan.dated ? 'text-success' : 'text-danger'}>{c.scan.dated ? 'yes' : 'no'}</strong></span>
                {c.scan.name && <span className="truncate">Name: {c.scan.name}</span>}
              </div>
              {c.scan.discrepancies.length > 0 && (
                <div className="flex items-start gap-1.5 mt-1.5 text-[11px] text-warning">
                  <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                  <span>{c.scan.discrepancies.map(d => d.field).join(' · ')}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 py-2">
            <span className="text-sm font-semibold text-ink w-[150px]">Signed and dated?</span>
            <div className="flex items-center gap-1.5">
              {[['Yes', true], ['No', false]].map(([text, val]) => {
                const on = current === val
                return (
                  <button key={text} type="button" disabled={busy}
                    onClick={() => setAnswers(a => ({ ...a, [c.entry_id]: val }))}
                    className={`px-3 py-1 rounded-md text-[12px] font-bold border-2 transition-colors ${
                      on ? (val ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-gray-600 border-gray-600 text-white')
                         : 'border-rule text-ink-muted hover:border-gray-400'}`}>
                    {text}
                  </button>
                )
              })}
              {scanSays !== undefined && answers[c.entry_id] === undefined && (
                <span className="text-[10px] text-ink-faint ml-1">pre-filled from the scan</span>
              )}
            </div>
          </div>

          <p className="text-[11px] text-ink-faint mt-1">
            Answering "no" records the problem and flags the vendor. It does not hold the invoice.
          </p>

          {err && <p className="text-[12px] text-danger mt-2">{err}</p>}

          <div className="pt-3 mt-3 border-t border-rule flex items-center justify-between gap-2">
            <span className="text-[10px] text-ink-faint">Y yes · N no · S skip · Enter record</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} onClick={skip}
                className="px-3 py-1.5 text-sm text-ink-muted hover:text-ink">Skip</button>
              <button type="button" disabled={busy || current === undefined} onClick={() => submit(current)}
                className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                {busy ? 'Saving…' : 'Record and next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ReviewDeck>
  )
}

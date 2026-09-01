import { useMemo, useState } from 'react'
import { Check, ChevronRight, FileText, Paperclip, Zap } from 'lucide-react'
import api from '../api'
import ReviewDeck from './ReviewDeck'
import ApprovalChecklistFields from './ApprovalChecklistFields'
import { answerCobrand as nextCobrand, checklistComplete, checklistPayload, checklistOutstanding }
  from '../lib/approvalChecklist'

// The checklist an approver completes before an invoice is accepted — ported
// from boom-dashboard's ApprovalChecklistDeck onto cadence's ReviewDeck shell.
// Every approve entry point on the Approvals page (row button, `a`, ⇧A,
// "Review all", "Review selected") opens THIS, never approves directly: a
// bypass anywhere makes the checklist optional in practice. The server
// enforces it independently (POST /ledger/entries/:id/approve refuses an
// incomplete checklist) — the disabled button here is a courtesy, not the gate.
//
// ── Editing un-ticks ────────────────────────────────────────────────────────
// Change a field and its confirmation clears. Not tidiness — correctness: the
// server forces category = 'Marketing' whenever cobrand is true, so an
// approver could confirm "category: Services", answer "yes, cobrand", and the
// row would save as Marketing — contradicting the checklist they just
// completed. Re-arming the tick makes that visible instead of silent.
//
// Answers live per-entry in state created on mount, so every open starts
// blank — answers are never inherited from a previous review.

const money = (a, c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(a || 0)

export default function ApprovalChecklistDeck({
  items = [],
  onApproved,
  onEntryPatched,
  onClose,
  // Reviewer-staged split rows for an entry (from the Approvals page's split
  // editor). Travels IN the approve payload — never a separate write, so a
  // failed approve leaves no half-applied split behind.
  breakdownFor,
}) {
  const [index, setIndex] = useState(0)
  const [checks, setChecks] = useState({})     // { [entryId]: { artist: true, cobrand: false, … } }
  const [drafts, setDrafts] = useState({})     // { [entryId]: { amount: '123', … } } — in-flight edits
  const [notes, setNotes] = useState({})       // { [entryId]: 'approval note' } — optional rider
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [approved, setApproved] = useState(0)
  const [skipped, setSkipped] = useState(0)

  const entry = items[index]
  const c = (entry && checks[entry.id]) || {}

  // What the row WILL hold once this checklist is applied — the card has to show
  // the value the approver is actually confirming, not the stored one.
  const pending = useMemo(() => {
    if (!entry) return {}
    const d = drafts[entry.id] || {}
    const category = c.cobrand === true ? 'Marketing' : (d.category ?? entry.category)
    return {
      artist: d.artist ?? entry.artist,
      song: d.song ?? entry.song,
      amount: d.amount ?? entry.amount,
      category,
    }
  }, [entry, drafts, c.cobrand])

  const setCheck = (key, val) => setChecks((p) => ({ ...p, [entry.id]: { ...(p[entry.id] || {}), [key]: val } }))

  // The implication (category re-armed, campaign forced) lives in
  // lib/approvalChecklist so Add Invoice's copy of this card cannot answer
  // cobrand differently from the deck's.
  const answerCobrand = (val) =>
    setChecks((p) => ({ ...p, [entry.id]: nextCobrand(p[entry.id] || {}, val) }))

  // Persist a field edit and clear its confirmation.
  const saveField = async (field, value) => {
    setBusy(true); setErr('')
    try {
      const body = { [field]: field === 'amount' ? Number(value) : (value || null) }
      if (field === 'amount' && !(Number(value) > 0)) throw new Error('Amount must be greater than zero')
      await api.patch(`/ledger/entries/${entry.id}`, body)
      setDrafts((p) => ({ ...p, [entry.id]: { ...(p[entry.id] || {}), [field]: body[field] } }))
      setChecks((p) => { const cur = { ...(p[entry.id] || {}) }; delete cur[field]; return { ...p, [entry.id]: cur } })
      onEntryPatched?.(entry.id, body)
    } catch (e) {
      setErr(e.response?.data?.error || e.message)
    } finally { setBusy(false) }
  }

  // Open the entry's document in a new tab via a signed URL — cadence's file
  // access pattern (boom's inline preview panel has no cadence equivalent yet).
  const openFile = async (type) => {
    try { const { data } = await api.get(`/ledger/entries/${entry.id}/file/${type}`); window.open(data.data.url, '_blank', 'noopener') }
    catch { setErr('Could not open the file') }
  }

  const complete = checklistComplete(c)

  const approve = async () => {
    if (!complete || busy) return
    setBusy(true); setErr('')
    try {
      // notify:false — vendor emails are queued by the page (per its Notify
      // toggle) and drained into EmailPreviewModal after the deck closes.
      const staged = breakdownFor?.(entry)
      await api.post(`/ledger/entries/${entry.id}/approve`, {
        checklist: checklistPayload(c),
        notify: false,
        notes: (notes[entry.id] || '').trim() || undefined,
        artist_breakdown: Array.isArray(staged) && staged.length > 1 ? staged : undefined,
      })
      setApproved((n) => n + 1)
      onApproved?.(entry)
      setIndex((i) => i + 1)
    } catch (e) {
      setErr(e.response?.data?.error || e.message)
    } finally { setBusy(false) }
  }

  const skip = () => { setSkipped((n) => n + 1); setIndex((i) => i + 1) }

  return (
    <ReviewDeck
      open
      title="Approval review"
      items={items}
      index={index}
      stats={{ approved, skipped }}
      onClose={onClose}
    >
      {(en) => (
        <div>
          <div className="pb-3 border-b border-rule">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[15px] font-black text-ink truncate">{en.payee}</div>
              <div className="text-[15px] font-black text-ink tabular-nums flex-shrink-0">
                {money(pending.amount, en.currency)}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="text-[11px] text-ink-faint truncate">
                {en.invoice_number ? `inv ${en.invoice_number} · ` : ''}
                {en.vendor_submitted ? 'vendor-submitted' : 'entered by hand'}
                {en.invoice_r2_key || en.w9_r2_key || en.receipt_r2_key ? '' : ' · no document attached'}
              </div>
              {en.rush && (
                <span className="ml-auto flex-shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-700">
                  <Zap size={10} /> Rush
                </span>
              )}
            </div>
            {/* The document beside the questions — an approval is a comparison,
                not a memory test. */}
            {(en.invoice_r2_key || en.w9_r2_key || en.receipt_r2_key) && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {en.invoice_r2_key && <button type="button" onClick={() => openFile('invoice')} className="inline-flex items-center gap-1.5 text-xs bg-page/60 border border-rule rounded-lg px-2.5 py-1.5 text-ink-muted hover:text-brand-ink"><FileText size={13} className="text-amber-500" /> Invoice</button>}
                {en.w9_r2_key && <button type="button" onClick={() => openFile('w9')} className="inline-flex items-center gap-1.5 text-xs bg-page/60 border border-rule rounded-lg px-2.5 py-1.5 text-ink-muted hover:text-brand-ink"><Paperclip size={13} /> W-9</button>}
                {en.receipt_r2_key && <button type="button" onClick={() => openFile('receipt')} className="inline-flex items-center gap-1.5 text-xs bg-page/60 border border-rule rounded-lg px-2.5 py-1.5 text-ink-muted hover:text-brand-ink"><Paperclip size={13} /> Receipt</button>}
              </div>
            )}
          </div>

          <div className="py-3">
            <ApprovalChecklistFields
              values={pending}
              checks={c}
              onCheck={setCheck}
              onCobrand={answerCobrand}
              onFieldChange={saveField}
              context={en}
              disabled={busy}
              fieldKey={String(en.id)} />
          </div>

          {/* The reviewer's corrected split, staged on the Approvals card,
              rides in the approve payload above. */}
          {(() => {
            const staged = breakdownFor?.(en)
            if (!Array.isArray(staged) || staged.length < 2) return null
            return (
              <p className="text-[11px] text-brand-ink pb-2">
                Will split across {staged.length} lines on approve ({staged.map(s => s.artist).filter(Boolean).join(', ')}).
              </p>
            )
          })()}

          {/* Optional approval note — appended to the row's notes trail at
              approve time, never replacing what's there. */}
          <div className="pb-2">
            <input
              value={notes[en.id] || ''}
              onChange={(e) => setNotes((p) => ({ ...p, [en.id]: e.target.value }))}
              disabled={busy}
              placeholder="Approval note (optional — appended to the entry's notes)"
              className="w-full px-2 py-1 text-[12px] border border-rule rounded-md bg-card text-ink placeholder:text-ink-faint"
            />
          </div>

          {err && <p className="text-[11px] text-danger pb-2">{err}</p>}

          <div className="pt-3 border-t border-rule flex items-center gap-2">
            <button
              type="button"
              onClick={skip}
              disabled={busy}
              className="px-3 py-2 rounded-lg text-[12px] font-bold text-ink-muted border border-rule hover:text-ink disabled:opacity-40 inline-flex items-center gap-1"
              title="Leave this one pending and move on"
            >
              Skip <ChevronRight size={13} />
            </button>
            <button
              type="button"
              onClick={approve}
              disabled={!complete || busy}
              className="ml-auto px-4 py-2 rounded-lg text-[13px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              title={complete ? 'Approve this invoice' : 'Every item has to be answered first'}
            >
              {busy ? 'Approving…' : <><Check size={14} strokeWidth={3} /> Approve</>}
            </button>
          </div>
          {!complete && (
            <p className="text-[11px] text-ink-faint mt-2">
              {checklistOutstanding(c).join(' · ')} still to answer
            </p>
          )}
        </div>
      )}
    </ReviewDeck>
  )
}

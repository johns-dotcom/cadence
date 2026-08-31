// The approval checklist: what it asks, and when it counts as complete.
// Ported from boom-dashboard's lib/approvalChecklist.js.
//
// ── Why this is a module and not two copies ────────────────────────────────
// Two surfaces run this checklist:
//
//   • the Approvals review deck, over invoices waiting in the queue
//   • Add Invoice, over the invoice being typed — because an approver's add is
//     written `status = 'approved'` on the spot (POST /ledger/entries), so it
//     never reaches the queue and would otherwise never be asked any of this.
//
// The questions, the cobrand implication and the completeness rule therefore
// have exactly one definition. The SERVER is still the gate
// (server/lib/approvalChecklist.js validateApprovalChecklist). Everything here
// is the courtesy on top of it.

// Four CONFIRMATIONS — only "yes, that's right" is an answer, so they are ticks.
export const CONFIRMATIONS = [
  { key: 'artist', label: 'Correct artist?', field: 'artist' },
  { key: 'song', label: 'Correct song?', field: 'song' },
  { key: 'amount', label: 'Correct amount?', field: 'amount' },
  { key: 'category', label: 'Correct category?', field: 'category' },
]

// Four ANSWERS — "no" is a real answer here and it gets WRITTEN, which is why
// these are Yes/No pairs and not checkboxes. All four columns default to a
// value, so without an explicit answer "somebody decided no" and "nobody ever
// looked" are the same row.
export const ANSWERS = [
  { key: 'bulk_deal', label: 'Bulk deal?', hint: 'A multi-deliverable deal (N videos, N posts)' },
  { key: 'cobrand', label: 'On cobrand?', hint: 'Cobrand spend is Marketing by definition — answering yes sets the category' },
  { key: 'recoupable', label: 'Recoupable?', hint: 'Chargeable back to the artist — this is what puts it on Recoupments' },
  { key: 'campaign', label: 'Campaign?', hint: 'Counts on Artist Campaigns and the campaign spend reports' },
]

/**
 * Answering cobrand answers two other things.
 *
 * Cobrand spend IS marketing spend, so yes forces category = 'Marketing', and
 * it IS campaign spend, so yes answers campaign too. Both are consequences,
 * not questions.
 *
 * An answer that MOVES the category clears the category confirmation, which is
 * correctness rather than tidiness: somebody could otherwise confirm "category:
 * Services", then answer "yes, cobrand", and the row would save as Marketing —
 * contradicting the checklist they just completed.
 *
 * It fires in exactly the two directions where the category actually moves:
 * answering YES (which forces Marketing) and answering no after a YES (which
 * releases it). Answering NO from unanswered changes no category, so the tick
 * stands.
 *
 * @returns the next checks object
 */
export function answerCobrand(cur = {}, val) {
  const next = { ...cur, cobrand: val }
  if (val === true || cur.cobrand === true) delete next.category
  if (val === true) next.campaign = true
  else if (cur.cobrand === true) delete next.campaign
  return next
}

/** Every confirmation ticked and every answer given. Mirrors the server's gate. */
export function checklistComplete(c = {}) {
  return CONFIRMATIONS.every((x) => c[x.key] === true)
    && typeof c.bulk_deal === 'boolean'
    && typeof c.cobrand === 'boolean'
    && typeof c.recoupable === 'boolean'
    // Cobrand yes IS campaign yes, so it does not need a second click for a
    // value the person cannot change.
    && (c.cobrand === true || typeof c.campaign === 'boolean')
}

/** The shape the server's validateApprovalChecklist expects. */
export function checklistPayload(c = {}) {
  return {
    artist: true, song: true, amount: true, category: true,
    bulk_deal: c.bulk_deal,
    cobrand: c.cobrand,
    recoupable: c.recoupable,
    // Sent as true when cobrand is — the server forces it anyway, and sending
    // the contradiction would just be something for it to correct.
    campaign: c.cobrand === true ? true : c.campaign,
  }
}

/** What is still unanswered, in the order the card asks it. For the hint line. */
export function checklistOutstanding(c = {}) {
  const out = CONFIRMATIONS.filter((x) => c[x.key] !== true).map((x) => x.key)
  for (const a of ANSWERS) {
    if (a.key === 'campaign' && c.cobrand === true) continue
    if (typeof c[a.key] !== 'boolean') out.push(a.key === 'bulk_deal' ? 'bulk deal' : a.key)
  }
  return out
}

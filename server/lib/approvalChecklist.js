// ── The approval checklist ─────────────────────────────────────────────────
//
// Ported from boom-dashboard (routes/bookkeeping.js :101-187), label-scoped.
// Approvers must confirm what they looked at before an invoice is accepted.
// Eight questions, and they are NOT the same kind of question — which is the
// whole reason this is a validator and not an "eight booleans, all true" check:
//
//   CONFIRMATIONS  artist · song · amount · category
//     "is this right?" — only `true` is an answer. `false` means the invoice is
//     wrong and belongs in a fix or a rejection, not an approval.
//
//   ANSWERS        bulk_deal · cobrand · recoupable · campaign
//     "is this one?" — `true` and `false` are BOTH valid, and they get WRITTEN
//     to is_bulk_deal / cobrand / recoupable / artist_campaign. Absent is not
//     an answer. This is the only thing that separates "someone decided no"
//     from "nobody ever looked" on columns that all carry a default.
//
// Lives on the SERVER because a disabled button is not a gate. The client
// deck's disabled state (client/src/lib/approvalChecklist.js mirrors these
// rules) is a convenience on top of this.
const CHECKLIST_CONFIRM = ['artist', 'song', 'amount', 'category'];
const CHECKLIST_ANSWER = ['bulk_deal', 'cobrand', 'recoupable', 'campaign'];

function validateApprovalChecklist(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'This invoice needs the approval checklist completed — approve it from the review on the Approvals page.' };
  }
  const missing = CHECKLIST_CONFIRM.filter((k) => raw[k] !== true);
  if (missing.length) {
    return { ok: false,
      error: 'Not confirmed: ' + missing.join(', ') + '. Every item has to be confirmed before this invoice can be approved — if one of them is wrong, fix it or reject the invoice.' };
  }
  // Cobrand spend IS campaign spend, so answering cobrand answers campaign — the
  // same implication that already forces category = 'Marketing'. Treated as
  // ANSWERED here rather than refused, because "automatically yes" is the
  // behaviour asked for and demanding a second click for a value the approver
  // cannot change would be theatre.
  const impliedCampaign = raw.cobrand === true;
  const unanswered = CHECKLIST_ANSWER.filter((k) => {
    if (k === 'campaign' && impliedCampaign) return false;
    return typeof raw[k] !== 'boolean';
  });
  if (unanswered.length) {
    return { ok: false,
      error: 'Not answered: ' + unanswered.join(', ') + '. Answer yes or no — leaving it blank is what makes "no" and "nobody looked" the same thing.' };
  }
  return { ok: true, value: {
    artist: true, song: true, amount: true, category: true,
    bulk_deal: raw.bulk_deal === true,
    cobrand: raw.cobrand === true,
    recoupable: raw.recoupable === true,
    // Forced, not merely defaulted: a client that sent cobrand=true with
    // campaign=false does not get to store the contradiction.
    campaign: impliedCampaign ? true : raw.campaign === true,
    campaign_implied_by_cobrand: impliedCampaign || undefined,
  } };
}

/** The checklist plus who answered it and when. Pure — no DB, so it can be
 *  built before a transaction and written inside it. */
function stampChecklist(checklist, user) {
  return { ...checklist, by: user?.name || null, at: new Date().toISOString() };
}

/**
 * Write the checklist onto the entry and apply the answers it carries.
 *
 * Takes the connection so it can run INSIDE a caller's transaction when one
 * exists — the stored checklist and the row it describes must not be able to
 * disagree.
 *
 * Cobrand rule mirrored from boom's PUT /entries/:id: cobrand spend IS
 * marketing spend, so answering yes forces category = 'Marketing'. That is
 * exactly why the client deck re-arms the category tick when the cobrand
 * answer changes — otherwise an approver confirms "category: Services" and the
 * row saves as Marketing, contradicting the checklist they just completed.
 *
 * Cadence deltas from boom: every write is label-scoped, and artist_campaign
 * is BOOLEAN here (NULL = auto-by-category, so an explicit true/false IS the
 * "somebody decided" record) rather than boom's TEXT 'Yes'/'No'.
 *
 * @param {object} q  pool, or a pinned client inside a transaction
 */
async function writeApprovalChecklist(q, labelId, entryId, stamped) {
  await q.query(
    `UPDATE expenses
        SET approval_checklist = $1::jsonb,
            is_bulk_deal = $2,
            cobrand = $3,
            category = CASE WHEN $3 THEN 'Marketing' ELSE category END,
            -- The answer, written to the column the recoupment surfaces read.
            -- expenses.recoupable is BOOLEAN DEFAULT TRUE, so without this
            -- nothing separates "recoupable because somebody decided" from
            -- "recoupable because nobody looked". Asking at approval makes it
            -- a decision for every invoice from here on.
            recoupable = $4,
            artist_campaign = $5
      WHERE id = $6 AND label_id = $7`,
    [JSON.stringify(stamped), stamped.bulk_deal, stamped.cobrand,
      stamped.recoupable, stamped.campaign, entryId, labelId]
  );
}

module.exports = { validateApprovalChecklist, stampChecklist, writeApprovalChecklist };

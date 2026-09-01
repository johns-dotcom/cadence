// Bulk / influencer deals — ONE definition of "what did we buy, what arrived,
// and is money running ahead of delivery".
//
// A bulk deal IS an approved `expenses` row flagged `is_bulk_deal`: one payment
// buying N deliverables (influencer videos, posts). The rollup SQL and the
// derivations live in the same file because TWO surfaces read them — the
// /bulk-deals tracker and the `bulk_deal_stalled` smart alert in
// /api/notifications. The reference app duplicated the JS rule in both files
// and they drifted, so the bell and the page disagreed about which deals were
// stalled.
//
// ── The money rules, in precedence order (held by finance-fixtures.cjs) ──
//
//   * CONTRACTED beats LOGGED. `bulk_deal_quantity` is what the deal bought;
//     the deliverables checklist is only what somebody remembered to type.
//     Progress reads against the LARGER of the two, so an un-logged deliverable
//     still counts against the vendor instead of quietly making a 2-of-10 deal
//     look 100% delivered.
//
//   * ITEMS beat the MANUAL COUNT. When `bulk_deal_items` rows exist they are
//     the delivered figure; `expenses.bulk_deal_completed` (an INT count, set
//     from Artist Campaigns) is the fallback for deals with no checklist. This
//     is the same precedence ArtistCampaignDetail already renders, so the two
//     surfaces cannot disagree about the same deal.
//
//   * INSTALLMENTS beat STATUS. When `payment_installments` rows exist they are
//     the precise paid figure; otherwise fall back to the family rows whose
//     payment_status is 'Paid'. NEVER add the two — an installment plan on a
//     row already marked Paid would double-count the whole deal.
//
//   * Paid is CLAMPED to the family total. An overpayment is a reconciliation
//     bug; it must not read as 130% delivery pressure on the vendor.
//
// Amounts are NEVER cross-currency summed here — every figure stays in the
// deal's own `currency` and the page rolls up per currency. A single "$" over a
// mixed-currency total is a number nobody can reconcile.
//
// ── `bulk_deal_completed` vs `bulk_deal_archived` ──
// `expenses.bulk_deal_completed` is an INT **count of delivered items** in this
// codebase (written by artist-campaigns, rendered as `n/quantity`). The
// reference app used a same-named BOOLEAN as the "move to the Completed
// archive" flag. Coercing one into the other would turn a count of 3 into
// `true` and archive the deal. So archiving has its own column,
// `bulk_deal_archived BOOLEAN`, and nothing in this file ever writes
// `bulk_deal_completed`.

const STALL_DAYS = 30;
const PAID_AHEAD_GAP = 25; // percentage points of paid-minus-delivered

// The rollup. $1 is label_id — every one of the four scans is label-scoped,
// including the sub-aggregates, so a shared expense_id can never pull another
// workspace's deliverables or installments into this workspace's totals.
const BULK_DEALS_SQL = `
  SELECT e.id, e.payee, e.artist, e.song, e.amount, e.currency, e.category,
         e.invoice_date, e.description, e.notes, e.payment_status,
         e.bulk_deal_quantity, e.bulk_deal_unit, e.bulk_deal_completed,
         COALESCE(e.bulk_deal_archived, FALSE) AS bulk_deal_archived,
         e.social_handles, e.created_at,
         (e.amount + COALESCE(ch.child_total, 0))::float AS combined_amount,
         COALESCE(bd.total_items, 0)::int      AS total_items,
         COALESCE(bd.completed_items, 0)::int  AS completed_items,
         bd.last_delivery_at,
         COALESCE(ch.child_count, 0)::int      AS split_count,
         COALESCE(ip.installments_paid, 0)::float AS installments_paid,
         COALESCE(ip.installment_count, 0)::int   AS installment_count,
         (CASE WHEN e.payment_status = 'Paid' THEN e.amount ELSE 0 END
           + COALESCE(ch.paid_child_total, 0))::float AS status_paid_total
    FROM expenses e
    LEFT JOIN (
      SELECT expense_id,
             COUNT(*) AS total_items,
             COUNT(*) FILTER (WHERE completed) AS completed_items,
             MAX(completed_at) AS last_delivery_at
        FROM bulk_deal_items WHERE label_id = $1 GROUP BY expense_id
    ) bd ON bd.expense_id = e.id
    LEFT JOIN (
      SELECT parent_id, COUNT(*) AS child_count, SUM(amount) AS child_total,
             SUM(amount) FILTER (WHERE payment_status = 'Paid') AS paid_child_total
        FROM expenses
       WHERE label_id = $1 AND parent_id IS NOT NULL
         AND (deleted = false OR deleted IS NULL)
         AND (voided = false OR voided IS NULL)
       GROUP BY parent_id
    ) ch ON ch.parent_id = e.id
    LEFT JOIN (
      SELECT expense_id, SUM(amount) AS installments_paid, COUNT(*) AS installment_count
        FROM payment_installments WHERE label_id = $1 GROUP BY expense_id
    ) ip ON ip.expense_id = e.id
   WHERE e.label_id = $1 AND e.is_bulk_deal = TRUE
     AND (e.deleted = false OR e.deleted IS NULL)
     AND (e.voided = false OR e.voided IS NULL)
     AND e.status = 'approved' AND e.parent_id IS NULL
   ORDER BY e.invoice_date DESC NULLS LAST, e.id DESC
`;

const num = (v) => Number(v) || 0;

// What the deal bought. Contracted quantity wins over checklist length.
function contractedOf(d) {
  return Math.max(num(d.bulk_deal_quantity), num(d.total_items));
}

// What arrived. Checklist rows win; the manual campaign count is the fallback.
function deliveredOf(d) {
  return num(d.total_items) > 0 ? num(d.completed_items) : num(d.bulk_deal_completed);
}

function deliveryOf(d) {
  const contracted = contractedOf(d);
  const delivered = deliveredOf(d);
  return {
    contracted,
    delivered,
    pct: contracted > 0 ? Math.min(100, Math.round((delivered / contracted) * 100)) : 0,
  };
}

// What we've actually paid, in the deal's own currency.
function paidOf(d) {
  const total = num(d.combined_amount != null ? d.combined_amount : d.amount);
  const raw = num(d.installment_count) > 0 ? num(d.installments_paid) : num(d.status_paid_total);
  const paid = Math.max(0, Math.min(raw, total));
  return { total, paid, pct: total > 0 ? Math.round((paid / total) * 100) : 0 };
}

// Stalled: money went out, the deal is still under-delivered, and nothing has
// arrived in 30+ days. Deals that never delivered anything get the same window
// measured from invoice_date, so a signing last week doesn't false-alarm.
function stalledOf(d, now = Date.now()) {
  const none = { stalled: false, days: null };
  if (d.bulk_deal_archived) return none;
  const pay = paidOf(d);
  if (!(pay.paid > 0)) return none;
  const del = deliveryOf(d);
  if (del.contracted > 0 && del.delivered >= del.contracted) return none;
  const anchor = d.last_delivery_at || d.invoice_date;
  if (!anchor) return none;
  const t = new Date(anchor).getTime();
  if (!Number.isFinite(t)) return none;
  const days = Math.floor((now - t) / 86400000);
  return { stalled: days >= STALL_DAYS, days };
}

// Attach every derived figure the client renders. Computed on the SERVER so the
// tracker, the notification bell and any future export read the same numbers —
// the client only formats them.
function deriveDeal(d, now = Date.now()) {
  const del = deliveryOf(d);
  const pay = paidOf(d);
  const st = stalledOf(d, now);
  // Risk signal: money is meaningfully ahead of deliverables — hold the next
  // tranche until delivery catches up. Suppressed when Stalled already says it
  // louder, so a card never wears both badges.
  const paidAhead = pay.pct - del.pct >= PAID_AHEAD_GAP && del.pct < 100;
  return {
    ...d,
    contracted: del.contracted,
    delivered: del.delivered,
    delivery_pct: del.pct,
    deal_total: pay.total,
    paid_total: pay.paid,
    paid_pct: pay.pct,
    paid_ahead: paidAhead && !st.stalled,
    stalled: st.stalled,
    stalled_days: st.days,
    // Per-unit economics. Contracted rate while the deal is live; the Completed
    // archive shows the EFFECTIVE rate (total ÷ what actually arrived), which is
    // the only honest number once the deal is closed under-delivered.
    unit_cost: del.contracted > 0 ? pay.total / del.contracted : null,
    effective_unit_cost: del.delivered > 0 ? pay.total / del.delivered : null,
  };
}

// Singular unit name for "$40/video" and for the ghost-slot titles.
function singularUnit(u) {
  const s = String(u || 'item').trim() || 'item';
  return s.endsWith('s') ? s.slice(0, -1) : s;
}

module.exports = {
  BULK_DEALS_SQL, STALL_DAYS, PAID_AHEAD_GAP,
  contractedOf, deliveredOf, deliveryOf, paidOf, stalledOf, deriveDeal, singularUnit,
};

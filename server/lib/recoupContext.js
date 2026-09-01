// Two pieces of context for a bank row somebody is about to judge recoupable.
//
// Both are computed ONCE per request and applied in JS. The obvious version —
// correlated subqueries on the row — re-scans `expenses` per row, and a review
// queue is easily four figures of rows against the whole ledger.
//
// Neither of these decides anything. They are what a person needs in front of
// them to answer well, and the reason they exist is that the row cannot say
// either thing by itself.

const { usdOf } = require('./usd');
const { artistKeyOf } = require('./artistKey');

/**
 * An artist whose name the payee contains: "Oxis Music, LLC" → Oxis.
 *
 * A CONVENIENCE on a row a human is already reading, never a mechanism. It is
 * returned as `artist_proposal`, the client pre-fills the picker with it, and
 * nothing writes it without somebody pressing the button —
 * shared-descriptor-is-not-an-identity: one 'PAYPAL' descriptor filed 154 pulls
 * under the wrong vendor in the reference app, and a payee is not an identity.
 *
 * Only the INVOICE side of the ledger is used as the vocabulary, because that
 * is where artists were typed by a person. Bank rows would feed the pile's own
 * guesses back into itself.
 *
 * The 4-character floor is not cosmetic: two- and three-letter artist keys
 * match inside almost any company name ("3ee" is inside "Three Fifteen Media"
 * once squashed), and a proposal that is wrong is worse than none — it invites
 * a click.
 */
async function loadArtistProposals(pool, labelId) {
  const empty = { size: 0, propose: () => null };
  try {
    const { rows } = await pool.query(
      `SELECT e.artist, COUNT(*)::int AS n
         FROM expenses e
        WHERE e.label_id = $1
          AND e.entry_source IS DISTINCT FROM 'bank_statement'
          AND COALESCE(e.recoupable, FALSE) = TRUE
          AND COALESCE(TRIM(e.artist), '') <> ''
          AND (e.deleted IS NULL OR e.deleted = FALSE)
          AND (e.voided IS NULL OR e.voided = FALSE)
        GROUP BY e.artist`,
      [labelId]
    );
    return { size: 0, ...buildProposalIndex(rows) };
  } catch (err) {
    console.error('artist proposals unavailable — the queue asks without them:', err.message);
    return empty;
  }
}

/**
 * Pure half of the above, so the ranking rule is fixture-able.
 * Longest key first ("may zoean" must beat a shorter key that also matches),
 * most-used spelling breaks a tie so the proposal is the name the rest of the
 * app already shows.
 */
function buildProposalIndex(rows) {
  const index = (rows || [])
    .map((r) => ({ name: r.artist, key: artistKeyOf(r.artist), n: Number(r.n) || 1 }))
    .filter((a) => a.key.length >= 4)
    .sort((a, b) => b.key.length - a.key.length || b.n - a.n);
  return {
    size: index.length,
    propose: (payee) => {
      const p = artistKeyOf(payee);
      if (!p) return null;
      const hit = index.find((a) => p.includes(a.key));
      return hit ? hit.name : null;
    },
  };
}

/**
 * Is there an invoice-side row for the same payee at the same amount?
 *
 * The case that matters: a bank `Advance` at $10,000 for a vendor that already
 * has eleven ledger rows at exactly $10,000 — a monthly arrangement, most of
 * them already claimed — so the bank row is almost certainly one of those
 * invoices booked a second time rather than a new advance. Marking it
 * recoupable claims the same $10,000 twice, and nothing else on the row hints
 * at it. The flag sends the reader to Bank Matching, which is where a bank line
 * gets tied to the invoice it paid.
 *
 * Deliberately payee + amount and nothing tighter. A date test would miss it:
 * the bank row's payment_date is when the money moved and the invoice's is
 * whatever was recorded, and a booked-from-bank row carries no invoice number
 * to compare. A "look before you answer" flag, not a match.
 */
async function loadLedgerTwins(pool, labelId) {
  const empty = { size: 0, find: () => null };
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.amount, e.currency, e.artist, e.ufr, e.invoice_number
         FROM expenses e
        WHERE e.label_id = $1
          AND e.entry_source IS DISTINCT FROM 'bank_statement'
          AND (e.deleted IS NULL OR e.deleted = FALSE)
          AND (e.voided IS NULL OR e.voided = FALSE)
          AND e.amount IS NOT NULL`,
      [labelId]
    );
    return buildTwinIndex(rows);
  } catch (err) {
    console.error('ledger twins unavailable — the queue asks without them:', err.message);
    return empty;
  }
}

/** Pure half of the above — the key shape is what the fixture holds. */
function twinKey(payee, amount) {
  return `${artistKeyOf(payee)}|${Number(amount || 0).toFixed(2)}`;
}

function buildTwinIndex(rows) {
  const byKey = new Map();
  for (const r of rows || []) {
    const k = twinKey(r.payee, r.amount);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({
      id: r.id, payee: r.payee, artist: r.artist, ufr: r.ufr === true,
      invoice_number: r.invoice_number,
      amount: Number(r.amount), currency: r.currency,
    });
  }
  return {
    size: byKey.size,
    find: (payee, amount) => {
      if (amount == null) return null;
      const hits = byKey.get(twinKey(payee, amount));
      return hits && hits.length ? hits : null;
    },
  };
}

/**
 * Attach both to a list of bank rows, in place, and return it.
 *
 * `amount_usd_calc` rides along because every caller sums these and the sum has
 * to come from `usdOf` — never face value, which reported $6,159,482 against a
 * page showing $5,772,443 in the reference app.
 */
function attachRecoupContext(rows, { proposals, twins }) {
  for (const r of rows || []) {
    r.artist_proposal = String(r.artist || '').trim() ? null : proposals.propose(r.payee);
    const t = twins.find(r.payee, r.amount);
    r.ledger_twin = t ? { count: t.length, rows: t.slice(0, 4) } : null;
    r.amount_usd_calc = usdOf(r.amount, r.currency, r.fx_rate_to_usd);
  }
  return rows;
}

module.exports = {
  loadArtistProposals, loadLedgerTwins, attachRecoupContext,
  buildProposalIndex, buildTwinIndex, twinKey,
};

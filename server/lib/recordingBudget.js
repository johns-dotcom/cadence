// Recording-budget arithmetic — the pure half, so the fixtures can hold it
// without a database. The route file is the only caller; the client mirrors
// these same shapes from the payload the route emits.
//
// Three rules that are easy to get wrong and expensive to get wrong:
//   * A line item's amount is qty × unit_price, ROUNDED AT THE LINE. The
//     sections subtotal is a sum of already-rounded lines, so the six section
//     totals and the grand subtotal can never disagree by a stray cent.
//   * Contingency is a percentage OF THE SUBTOTAL, added on top — it is not
//     inside it. `total = subtotal × (1 + pct/100)`.
//   * A fund budget's balance is fund − advance − <planned or spent>. The
//     advance comes out FIRST: it is money already handed over, so the
//     recording fund available is what is left after it, and every downstream
//     figure hangs off that remainder.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const SECTIONS = ['producers', 'studio', 'mixing_mastering', 'musicians', 'travel', 'other'];

// Section → default ledger category, used when a planned line names no
// category of its own. Costs-to-Date groups by ledger category (the vocabulary
// the money is already filed under), not by these six template sections.
const SECTION_TO_DEFAULT_CATEGORY = {
  producers: 'Production',
  studio: 'Recording',
  mixing_mastering: 'Mixing & Mastering',
  musicians: 'Services',
  travel: 'Travel',
  other: 'Other',
};

/** The stored amount for a line: qty × unit_price, rounded at the line. */
const lineAmount = (qty, unitPrice) => round2(num(qty) * num(unitPrice));

/**
 * Roll a set of line items into the header figures.
 * `items` need only `{ section, amount }`.
 */
function budgetTotals(items, contingencyPct) {
  const pct = num(contingencyPct);
  const section_totals = Object.fromEntries(SECTIONS.map(s => [s, 0]));
  let subtotal = 0;
  for (const it of items || []) {
    const a = round2(it.amount);
    subtotal += a;
    if (section_totals[it.section] !== undefined) section_totals[it.section] += a;
  }
  subtotal = round2(subtotal);
  for (const s of SECTIONS) section_totals[s] = round2(section_totals[s]);
  const contingency_amount = round2(subtotal * (pct / 100));
  return { sections_subtotal: subtotal, contingency_amount, total_budget: round2(subtotal + contingency_amount), section_totals };
}

/**
 * The Fund template's header panel. `total` is the planned Total LP Budget.
 * Negative `balance_due_on_delivery` means the plan overruns the fund — a real
 * state the sheet has to be able to show, not an error.
 */
function fundPanel({ fund_amount, advance_amount, total_budget, contingency_amount }) {
  const fund = num(fund_amount);
  const advance = num(advance_amount);
  const total = num(total_budget);
  return {
    recording_fund_available: round2(fund - advance),
    total_lp_budget: round2(total),
    balance_due_on_delivery: round2(fund - advance - total),
    contingency: round2(num(contingency_amount)),
  };
}

/** The Costs-to-Date summary, whose shape depends on the budget type. */
function costsSummary(type, { fund_amount, advance_amount, planned, spent }) {
  const s = round2(spent);
  if (type === 'fund') {
    const fund = num(fund_amount);
    const advance = num(advance_amount);
    return {
      fund, advance,
      remainder_after_advance: round2(fund - advance),
      spent: s,
      balance_of_fund: round2(fund - advance - s),
    };
  }
  const p = round2(planned);
  return { budget_planned: p, spent: s, remaining: round2(p - s) };
}

module.exports = { SECTIONS, SECTION_TO_DEFAULT_CATEGORY, lineAmount, budgetTotals, fundPanel, costsSummary, round2 };

#!/usr/bin/env node
// Pure-function fixtures for the finance build — no database. Run:
//   node server/scripts/finance-fixtures.cjs
// These hold the properties the reference app paid for in production; a
// failure here means a money rule changed meaning, not a style problem.

process.env.DISABLE_TENANT_ASSERT = '1';
const assert = (name, cond) => {
  if (cond) { console.log(`PASS  ${name}`); return true; }
  console.error(`FAIL  ${name}`);
  process.exitCode = 1;
  return false;
};

const R = require('../lib/bankReconcile');
const { suggestCategory, suggestIncomeType } = require('../lib/statementSuggest');
const { normalizeBankPayee } = require('../lib/normalizeBankPayee');
const { fingerprintOfExpense } = require('../lib/reportFingerprint');
const { artistKeyOf, artistBucketKey, namesAnArtist } = require('../lib/artistKey');
const { usdOf, round2 } = require('../lib/usd');
const { pairReversals } = require('../lib/reversalPairs');
const { proposeFundingPairs, namesRecipient } = require('../lib/fundingPairs');
const { excludeBankRows, isCreatorRow, reportingThresholdFor,
  restoreMatchPlan, CREATOR_MATCH_DETAIL } = require('../lib/ledgerSource');

// ── Evidence (V3 A7) ─────────────────────────────────────────────────────────
assert('invoice # in wire text', !!R.refEvidence({ description: 'WIRE PMT DET: INV 003' }, { invoice_number: '#003' }));
assert('MMDD guard — card date is not invoice 227', !R.refEvidence({ description: 'PURCHASE 0227 FACEBK' }, { invoice_number: '227' }));
assert('leading zeros normalize', !!R.refEvidence({ description: 'payment 00123' }, { invoice_number: 'INV-123' }));
assert('payment_ref substring', !!R.refEvidence({ description: 'ACH CONF 9GH2KX88 OUT' }, { payment_ref: '9GH2KX88' }));
assert('short refs never match', !R.refEvidence({ description: 'ref 12' }, { payment_ref: '12' }));

const maps = { payeeMap: { '~facebk': 'meta platforms' }, aliasGroups: new Map(), emailByVendor: new Map() };
assert('normalized learned map hits a DIFFERENT descriptor', R.evidence({ payee_guess: 'FACEBK *R3FA8FDGP2 650-5434000' }, { payee: 'Meta Platforms' }, maps).score === 1.0);
const g = new Set(['edward marange', 'eddie marange']);
const aliasMaps = { payeeMap: {}, aliasGroups: new Map([['edward marange', g], ['eddie marange', g]]), emailByVendor: new Map() };
assert('alias exact = 0.95 auto-alias', (() => { const e = R.evidence({ payee_guess: 'Eddie Marange' }, { payee: 'Edward Marange' }, aliasMaps); return e.score === 0.95 && e.method === 'auto-alias'; })());
assert('email tier = 1.0 auto-email', (() => { const e = R.evidence({ payee_guess: 'x', payee_email: 'v@x.com' }, { payee: 'Someone Else', vendor_email: 'V@X.COM' }, { payeeMap: {}, aliasGroups: new Map(), emailByVendor: new Map() }); return e.score === 1.0 && e.method === 'auto-email'; })());

// ── Score calibration (must preserve) ────────────────────────────────────────
const cal = (amount, name, date) => amount * 0.55 + name * 0.30 + date * 0.15;
assert('exact + perfect name + unpaid (neutral date) ≥ 0.90', cal(1, 1, 0.5) >= 0.90);
assert('exact + perfect name + paid 3d off ≥ 0.90', cal(1, 1, Math.max(0, 1 - 3 / 7)) >= 0.90);
assert('amount-only same-day ≤ 0.70 (below every automation threshold)', cal(1, 0, 1) <= 0.70 + 1e-9);

// ── Category / income suggestions (V2 §11) ───────────────────────────────────
assert('"UBER *EATS" → Meals', suggestCategory('UBER *EATS', '') === 'Meals & Entertainment');
assert('"UBER *TRIP" → Travel', suggestCategory('UBER *TRIP 8005928996', '') === 'Travel');
assert('"External transfer fee - Next Day" → Bank Fees', suggestCategory('', 'External transfer fee - Next Day') === 'Bank Fees');
assert('"Producer fee" → null (vendor fees unsuggested)', suggestCategory('Producer fee', '') === null);
assert('"GUSTO PAYROLL" → Salary', suggestCategory('GUSTO', 'GUSTO PAYROLL 123') === 'Salary');
assert('"STEM ADVANCE" → Drawdown Fund (before distributor rule)', suggestIncomeType('', 'STEM ADVANCE JUL') === 'Drawdown Fund');
assert('"Advanced Audio LLC" → null (word boundary)', suggestIncomeType('Advanced Audio LLC', '') === null);
assert('"DISTROKID payout" → Streaming / Distribution', suggestIncomeType('DISTROKID', 'payout') === 'Streaming / Distribution');
assert('"reversal of payment" → Refund', suggestIncomeType('', 'reversal of payment from X') === 'Refund');

// ── Fingerprints survive descriptor noise + payee-less rows ─────────────────
assert('descriptor-stable txn fingerprint', R.txnFingerprint({ txn_date: '2026-03-01', amount: 100, payee_guess: 'FACEBK *BXJJYTMFP2 650-543-4800' })
  === R.txnFingerprint({ txn_date: '2026-03-01', amount: 100, payee_guess: 'FACEBK *2THTXF' }));
assert('payee-less report fingerprint is never empty-keyed', fingerprintOfExpense({ payment_date: '2026-03-01', amount: 50, payee: '' }).split('|')[3] === '');
assert('report fingerprint carries 2dp amount', fingerprintOfExpense({ payment_date: '2026-03-01', amount: 50.5, payee: 'X' }).includes('|50.50|'));

// ── Artist keys ──────────────────────────────────────────────────────────────
assert('strip-all key matches campaigns normKey', artistKeyOf('Nobody-Serious ') === 'nobodyserious');
assert('placeholders fold to unattributed', artistBucketKey('N/A') === '' && artistBucketKey('tbd') === '');
assert('"unknown" is a REAL artist (John\'s call — do not re-add to placeholders)', namesAnArtist('unknown') === true);

// ── USD ──────────────────────────────────────────────────────────────────────
assert('locked rate wins', usdOf(92, 'EUR', 0.92) === 100);
assert('USD is 1:1', usdOf(55, 'USD', null) === 55);
assert('round2 rounds at the row', round2(140.666) === 140.67);

// ── Reversal pairs ───────────────────────────────────────────────────────────
const revs = pairReversals([
  { id: 1, direction: 'debit', dismissed: false, account: 'bofa', amount: 500, txn_date: '2026-03-01', payee_guess: 'Acme Corp', description: 'WIRE OUT ACME CORP' },
  { id: 2, direction: 'credit', dismissed: false, account: 'bofa', amount: 500, txn_date: '2026-03-05', payee_guess: 'Acme Corp', description: 'RETURNED WIRE refund ACME CORP' },
  { id: 3, direction: 'credit', dismissed: false, account: 'bofa', amount: 500, txn_date: '2026-03-05', payee_guess: '', description: 'refund' },
]);
assert('reversal pairs need positive counterparty evidence', revs.length === 1 && revs[0].debit.id === 1 && revs[0].credit.id === 2);

// ── Funding pairs ────────────────────────────────────────────────────────────
const fp = proposeFundingPairs(
  [{ id: 10, txn_date: '2026-03-02', amount: 100, currency: 'GBP', payee_guess: 'Dylan Goldsmith Media' }],
  [{ id: 20, txn_date: '2026-03-03', amount: 130, currency: 'USD', payee_guess: 'PAYPAL', description: 'PAYPAL DES:INST XFER DYLAN GOLDSMITH MEDIA' }]
);
assert('cross-currency funding pair proposed (named recipient)', fp.pairs.length === 1);
assert('short-prefix recipient refused', namesRecipient('PAYPAL INST XFER DG', 'DG') === false);

// ── ledgerSource ─────────────────────────────────────────────────────────────
assert('exclusion uses IS DISTINCT FROM (null-safe)', excludeBankRows('e').includes('IS DISTINCT FROM'));
assert('inclusion uses plain equality', isCreatorRow('e').includes("= 'creator_payment'"));
assert('OBBBA thresholds', reportingThresholdFor(2025) === 600 && reportingThresholdFor(2026) === 2000);

// Undoing a creator conversion. `match_method='creator'` is
// explained-never-invoice-backed; an earlier build reset every relabelled match
// to 'manual' unconditionally, and 'manual' IS counted as invoice-backed — so
// unconverting promoted an undocumented row into the one bucket the creator
// disposition exists to keep it out of.
const auditRows = [
  { detail: `${CREATOR_MATCH_DETAIL}77`, old_value: 'auto-email' },
  { detail: `${CREATOR_MATCH_DETAIL}78`, old_value: null },
  { detail: 'Moved to Creator Payments from recoupment', old_value: 'recoupment' },
];
const plan = restoreMatchPlan(auditRows);
assert('unconvert restores the AUDITED prior method, never a default "manual"',
  plan.length === 2 && plan[0].txn_id === 77 && plan[0].match_method === 'auto-email'
  && !plan.some((p) => p.match_method === 'manual'));
assert('a match that carried NO method goes back to NULL, not to an invented one',
  plan[1].txn_id === 78 && plan[1].match_method === null);
assert('the entry_source audit row is not mistaken for a match',
  !plan.some((p) => Number.isNaN(p.txn_id)));
assert('newest audit wins per transaction, and junk ids are dropped',
  (() => {
    const p2 = restoreMatchPlan([
      { detail: `${CREATOR_MATCH_DETAIL}77`, old_value: 'auto-alias' },
      { detail: `${CREATOR_MATCH_DETAIL}77`, old_value: 'manual' },
      { detail: `${CREATOR_MATCH_DETAIL}abc`, old_value: 'manual' },
      { detail: `${CREATOR_MATCH_DETAIL}-3`, old_value: 'manual' },
    ]);
    return p2.length === 1 && p2[0].match_method === 'auto-alias';
  })());
assert('no audit means no restore — the match stays "creator", which over-states nothing',
  restoreMatchPlan([]).length === 0 && restoreMatchPlan(null).length === 0);

// ── Statement lens (the bank half's tie-out) ────────────────────────────────
const L = require('../lib/statementLens');

// Disposition order is the rule, not an implementation detail.
assert('dismissed beats a stale matched_expense_id',
  L.dispositionOf({ direction: 'debit', dismissed: true, matched_expense_id: 7 }) === 'dismissed');
assert('a booking is not a match',
  L.dispositionOf({ direction: 'debit', matched_expense_id: 7, booked: true, exp_payment_status: 'Paid' }) === 'booked');
assert("match_method 'created' also books (the drift the two old copies had)",
  L.dispositionOf({ direction: 'debit', matched_expense_id: 7, match_method: 'created', exp_payment_status: 'Paid' }) === 'booked');
assert('matched vs toconfirm turns on the ENTRY reading Paid',
  L.dispositionOf({ direction: 'debit', matched_expense_id: 7, exp_payment_status: 'Paid' }) === 'matched'
  && L.dispositionOf({ direction: 'debit', matched_expense_id: 7, exp_payment_status: 'Unpaid' }) === 'toconfirm');
assert('credits partition into booked-income / dismissed / open-credit',
  L.dispositionOf({ direction: 'credit', matched_income_id: 3 }) === 'booked-income'
  && L.dispositionOf({ direction: 'credit', dismissed: true }) === 'dismissed'
  && L.dispositionOf({ direction: 'credit' }) === 'open-credit');
assert('creator is a LENS bucket only — dispositionOf still says matched',
  L.lensBucketOf({ direction: 'debit', matched_expense_id: 7, match_method: 'creator', exp_payment_status: 'Paid' }) === 'creator'
  && L.dispositionOf({ direction: 'debit', matched_expense_id: 7, match_method: 'creator', exp_payment_status: 'Paid' }) === 'matched');

// Value: locked/printed USD wins, and direction never subtracts.
assert('txUsd prefers the request-time usd, then amount_usd, then face',
  L.txUsd({ usd: 100, amount_usd: 999, amount: 888 }) === 100
  && L.txUsd({ amount_usd: 130, amount: 100 }) === 130
  && L.txUsd({ amount: 55 }) === 55);
assert('a debit stored negative does not subtract from the debit total', L.txUsd({ amount: -500 }) === 500);

// The tie-out: beginning + credits − debits = ending, to the cent.
// 1000 + 400 − (300 + 100.005 + 100.005) = 899.99. Rounding each debit FIRST
// would give 500.02 out and a closing 899.98 — a cent of drift invented by the
// arithmetic, which is the exact failure round-once prevents.
const stTies = { id: 1, account: 'bofa', beginning_balance: 1000, ending_balance: 899.99 };
const txns = [
  { id: 1, direction: 'debit', amount: 300, booked: true, matched_expense_id: 11 },
  { id: 2, direction: 'debit', amount: 100.005, matched_expense_id: 12, exp_payment_status: 'Paid' },
  { id: 3, direction: 'debit', amount: 100.005, match_method: 'creator', matched_expense_id: 13, exp_payment_status: 'Paid' },
  { id: 4, direction: 'credit', amount: 400, matched_income_id: 9 },
];
const S = L.summariseStatement(stTies, txns);
assert('tie-out ties exactly', S.ties === true && S.drift === 0 && S.computed === 899.99);
assert('rounds ONCE at the end, not per part (0.005 + 0.005 must not become 0.02)',
  S.moneyOut.usd === 500.01);
assert('in and out are subtotalled apart, never netted',
  S.moneyIn.usd === 400 && S.moneyIn.n === 1 && S.moneyOut.n === 3);
assert('creator is counted apart from matched in the summary',
  S.moneyOut.by.creator.n === 1 && S.moneyOut.by.matched.n === 1 && S.moneyOut.by.booked.n === 1);
assert('every line lands in exactly one bucket per direction',
  Object.values(S.moneyOut.by).reduce((a, b) => a + b.n, 0) === S.moneyOut.n
  && Object.values(S.moneyIn.by).reduce((a, b) => a + b.n, 0) === S.moneyIn.n);
assert('drift is reported, not swallowed',
  (() => { const D = L.summariseStatement({ beginning_balance: 1000, ending_balance: 900 }, txns); return D.ties === false && D.drift === -0.01; })());
assert('no balances = nothing to tie against, not a failure',
  (() => { const N = L.summariseStatement({ beginning_balance: null, ending_balance: 0 }, txns); return N.hasBalances === false && N.ties === false && N.drift === null; })());
assert('a 0/0 PayPal statement counts as having no balances',
  L.summariseStatement({ beginning_balance: 0, ending_balance: 0 }, txns).hasBalances === false);

// Extra lines: every statement line appears somewhere on a page claiming to
// account for the month.
const onScreen = new Set([1]);
assert('a booked line WITH its ledger row on screen is not repeated',
  !L.extraTransactions(txns, onScreen, 'out').some((t) => t.id === 1));
assert('a booked line whose row the filters hide resurfaces rather than vanishing',
  L.extraTransactions(txns, new Set(), 'out').some((t) => t.id === 1));
assert('matched lines are always extra here — their invoice lives on the other half',
  L.extraTransactions(txns, onScreen, 'out').map((t) => t.id).includes(2));
assert('the credit side is never in the money-out list, and is in the money-in one',
  !L.extraTransactions(txns, onScreen, 'out').some((t) => t.id === 4)
  && L.extraTransactions(txns, onScreen, 'in').map((t) => t.id).includes(4));

// ── Recoupment statements (Phase 5) ─────────────────────────────────────────
// The 20th cutoff decides which partner statement a claim lands on, and the
// stamp is the only input. Both directions of the boundary are held here.
const SM = require('../lib/statementMonth');
const RC = require('../lib/recoupments');

assert('day 20 stays in its own statement', SM.statementMonthFor('2026-03-20T23:00:00Z') === '2026-03');
assert('day 21 rolls into the next statement', SM.statementMonthFor('2026-03-21T00:00:00Z') === '2026-04');
assert('Dec 21 rolls the YEAR too', SM.statementMonthFor('2026-12-21T12:00:00Z') === '2027-01');
assert('no stamp = no statement, never "this month"',
  SM.statementMonthFor(null) === null && SM.statementMonthFor(undefined) === null && SM.statementMonthFor('') === null);
assert('a move stamp round-trips to the month asked for',
  SM.statementMonthFor(SM.statementStampFor('2026-04')) === '2026-04'
  && SM.statementMonthFor(SM.statementStampFor('2026-12')) === '2026-12');
assert('a move stamp is noon UTC on the 1st — day 1 is <= 20 in every timezone',
  SM.statementStampFor('2026-04').toISOString() === '2026-04-01T12:00:00.000Z');
assert('junk months are refused, not silently stamped as now',
  SM.statementStampFor('2026-13') === null && SM.statementStampFor('nope') === null && SM.statementStampFor('') === null);
assert('the window a statement covers is release-to-release, not calendar',
  SM.statementWindowLabel('2026-06') === 'May 21, 2026 – Jun 20, 2026');

// The four bank-evidence states must mean the same thing on the server as in
// client/src/utils/recoupState.js — a row cannot read verified on one screen
// and unverified on another.
const paidNoLine = { payment_status: 'Paid', bank_evidence: null, bank_expected: true };
assert('paid + a covering statement + no line = the one discrepancy',
  RC.recoupStateOf(paidNoLine) === 'unverified' && RC.bankUnverified(paidNoLine));
assert('paid with no statement in yet is counted, not a problem',
  RC.recoupStateOf({ payment_status: 'Paid', bank_evidence: null, bank_expected: false }) === 'awaiting_statement'
  && RC.recoupCounted({ payment_status: 'Paid', bank_evidence: null, bank_expected: false }));
assert('unverified spend is NOT in the counted headline',
  !RC.recoupCounted(paidNoLine));
assert('unpaid beats "expected" — nothing left the bank',
  RC.recoupStateOf({ payment_status: 'Unpaid', bank_expected: true }) === 'unpaid');
assert('provable-and-unclaimed is verified AND not yet claimed',
  RC.isProvableUnclaimed({ bank_evidence: { id: 1 }, payment_status: 'Paid', ufr: false })
  && !RC.isProvableUnclaimed({ bank_evidence: { id: 1 }, payment_status: 'Paid', ufr: true })
  && !RC.isProvableUnclaimed(paidNoLine));
assert('priority is a closed vocabulary — anything else is rejected, not stored',
  RC.normalizePriority('High') === 'high' && RC.normalizePriority('l') === 'low'
  && RC.normalizePriority('') === null && RC.normalizePriority('urgent') === undefined);
assert('the bank-review gate is part of the base predicate, not an optional filter',
  RC.recoupBaseSql('e').includes('recoup_reviewed') && RC.recoupBaseSql('e').includes('parent_id IS NULL'));
assert('best spelling keeps the most-used name, ties to the longest',
  RC.bestSpelling(['LIFELINE', 'Life/Line', 'Life/Line']) === 'Life/Line'
  && RC.bestSpelling(['Oxis', 'Oxis Music']) === 'Oxis Music');


// ── Recoupment integrity audit (Phase 5) ────────────────────────────────────
// Five checks whose whole value is that they are RIGHT about small numbers.
const RCLS = require('../lib/recoupClass');
const RCTX = require('../lib/recoupContext');
const RAUD = require('../lib/recoupAudit');

// Class rules: equality, never substring. Two live categories differ only by a
// suffix, and a `Salary` rule that swallowed `Salary (Felipe)` would take
// $191,646 of somebody else's decision off the queue silently.
const rules = RCLS.rulesFrom([
  { scope: 'category', rule_key: 'Salary' },
  { scope: 'vendor', rule_key: '  Tone  Pay, Inc ' },
]);
assert('a category rule covers its own category and NOT a suffixed sibling',
  rules.has('anyone', 'Salary') && !rules.has('anyone', 'Salary (Felipe)'));
assert('a vendor rule covers that payee whatever the category, and only that payee',
  rules.has('Tone Pay, Inc', 'Marketing') && !rules.has('Tone Pay Media', 'Marketing'));
assert('rule keys normalize whitespace + case on BOTH sides',
  rules.has('tone   pay, inc', 'x') && rules.has('x', 'salary'));
assert('the rule predicate is label-scoped and matches on equality, not LIKE',
  RCLS.notClassRuledSql('e', '$1').includes('rcr.label_id = $1')
  && !/LIKE/i.test(RCLS.notClassRuledSql('e', '$1')));

// Artist proposals: a convenience on a row somebody is already reading. A wrong
// proposal is worse than none, because it invites a click.
const prop = RCTX.buildProposalIndex([
  { artist: 'Oxis', n: 5 }, { artist: 'May Zoean', n: 2 }, { artist: '3ee', n: 40 },
]);
assert('the payee proposes the artist it contains',
  prop.propose('Oxis Music, LLC') === 'Oxis' && prop.propose('MAY ZOEAN') === 'May Zoean');
assert('short keys never propose — "3ee" is inside "Three Fifteen Media" once squashed',
  prop.propose('Three Fifteen Media') === null);
assert('a payee that names nobody proposes nothing rather than guessing',
  prop.propose('FIRESTARTER LLC') === null);
assert('a row that already names an artist is never given a proposal',
  RCTX.attachRecoupContext(
    [{ id: 1, payee: 'Oxis Music, LLC', artist: 'Someone', amount: 10, currency: 'USD' }],
    { proposals: prop, twins: { find: () => null } })[0].artist_proposal === null);

// Ledger twins: payee + amount to the cent, and nothing tighter.
const twins = RCTX.buildTwinIndex([
  { id: 7, payee: 'Oxis Music, LLC', amount: '10000.00', artist: 'Oxis', ufr: true },
  { id: 8, payee: 'Oxis Music LLC', amount: 10000, artist: 'Oxis', ufr: false },
]);
assert('an invoice row at the same payee and amount is a twin, punctuation and all',
  (twins.find('OXIS MUSIC LLC', 10000) || []).length === 2);
assert('a cent apart is not a twin, and a missing amount asks nothing',
  !twins.find('Oxis Music, LLC', 10000.01) && !twins.find('Oxis Music, LLC', null));

// USD: round ONCE at the end. Three thirds of a cent round to 0.01 each and sum
// to 0.03 — the audit must report 0.02, which is what the money actually is.
const thirds = [1, 2, 3].map(() => ({ amount: 0.005, currency: 'USD' }));
assert('audit sums round once at the end, not per row',
  RAUD.sumUsd(thirds) === 0.02);
assert('a foreign row is summed at its LOCKED rate, never at face value',
  RAUD.sumUsd([{ amount: 200, currency: 'EUR', fx_rate_to_usd: 2 }]) === 100);

// Check 3 — a sensor, not a verdict.
const claimed = [
  { id: 1, payee: 'Vendor A', invoice_number: 'INV-001', artist: 'Alpha', amount: 100, currency: 'USD' },
  { id: 2, payee: 'vendor a', invoice_number: '001', artist: 'Beta', amount: 100, currency: 'USD' },
  { id: 3, payee: 'Vendor B', invoice_number: 'X9', artist: 'Alpha', amount: 900, currency: 'USD' },
  { id: 4, payee: 'Vendor B', invoice_number: 'X9', artist: 'Alpha', amount: 900, currency: 'USD' },
  { id: 5, payee: 'Vendor C', invoice_number: null, artist: 'Alpha', amount: 5000, currency: 'USD' },
  { id: 6, payee: 'Vendor C', invoice_number: '', artist: 'Beta', amount: 5000, currency: 'USD' },
];
const dc = RAUD.groupDoubleClaims(claimed);
assert('the same invoice number normalizes across spellings into one group',
  dc.length === 2 && dc.every(g => g.rows.length === 2));
assert('no invoice number is not evidence of anything — those rows never group',
  !dc.some(g => g.rows.some(r => r.id === 5 || r.id === 6)));
assert('a cross-artist group sorts first even when it is the smaller one',
  dc[0].cross_artist === true && dc[0].usd === 200 && dc[1].cross_artist === false);

// Check 5 — half a payment claimed. Reachable by claiming an entry and THEN
// splitting it: `/ledger/entries/:id/split` gives the parent the first slice and
// creates children without `ufr`.
const fam = RAUD.partialFamilies([
  { id: 10, parent_id: null, ufr: true, payee: 'Studio', artist: 'Alpha', amount: 300, currency: 'USD' },
  { id: 11, parent_id: 10, ufr: false, payee: 'Studio', artist: 'Beta', amount: 300, currency: 'USD' },
  { id: 12, parent_id: 10, ufr: false, payee: 'Studio', artist: 'Gamma', amount: 400, currency: 'USD' },
  { id: 20, parent_id: null, ufr: true, payee: 'Whole', artist: 'Alpha', amount: 50, currency: 'USD' },
  { id: 21, parent_id: 20, ufr: true, payee: 'Whole', artist: 'Alpha', amount: 50, currency: 'USD' },
  { id: 30, parent_id: null, ufr: false, payee: 'Untouched', artist: 'Alpha', amount: 9, currency: 'USD' },
  { id: 31, parent_id: 30, ufr: false, payee: 'Untouched', artist: 'Alpha', amount: 9, currency: 'USD' },
]);
assert('only families with a claim AND an open slice are findings',
  fam.length === 1 && fam[0].root_id === 10);
assert('the finding separates what was claimed from what is still open',
  fam[0].claimed_usd === 300 && fam[0].open_usd === 700 && fam[0].open_ids.join(',') === '11,12');
assert('open slices below the root are named as unreachable from the root-only surfaces',
  fam[0].hidden_ids.join(',') === '11,12');

// Check 4 — grouped by artist, because that is the conversation it protects.
const nodoc = RAUD.groupNoDocument([
  { id: 1, artist: 'Alpha', amount: 10, currency: 'USD' },
  { id: 2, artist: '  ', amount: 500, currency: 'USD' },
  { id: 3, artist: 'Alpha', amount: 20, currency: 'USD' },
]);
assert('undocumented claims group by artist, biggest exposure first, blanks named',
  nodoc.length === 2 && nodoc[0].artist === '— no artist' && nodoc[1].list.length === 2 && nodoc[1].usd === 30);
// ── Artist Campaigns: the two-layer double-count guard (Phase 5) ─────────────
// The page states Settled and Committed and ADDS them, so no row may be in both.
// The guard is set MEMBERSHIP of what buildPnl reported it counted — never a
// re-derived predicate, because "approved and Paid and dated in range and not
// report-dismissed and not month-moved" drifts the first time either side moves.
const CS = require('../lib/campaignScope');
const layerRows = [
  { id: 1, amount: 100, payment_status: 'Paid' },
  { id: 2, amount: 250, payment_status: 'Unpaid' },
  { id: 3, amount: 700, payment_status: 'Paid' },
];
const part = CS.partitionByLayer(layerRows, new Set([1, 3]));
assert('a row the P&L counted lands in Settled ONLY',
  part.settled.map(r => r.id).join(',') === '1,3' && part.committed.map(r => r.id).join(',') === '2');
assert('the two layers PARTITION the rows — every row exactly once',
  part.settled.length + part.committed.length === layerRows.length
  && new Set([...part.settled, ...part.committed].map(r => r.id)).size === layerRows.length);
assert('the layers sum to the whole, so Settled + Committed is the total',
  part.settled.reduce((s, r) => s + r.amount, 0) + part.committed.reduce((s, r) => s + r.amount, 0)
    === layerRows.reduce((s, r) => s + r.amount, 0));
assert('a row duplicated by a join contributes ONCE, not twice',
  CS.partitionByLayer([...layerRows, { id: 2, amount: 250 }], new Set([1])).committed
    .reduce((s, r) => s + r.amount, 0) === 950);
assert('an empty counted set puts everything in Committed (the pre-report state)',
  CS.partitionByLayer(layerRows, new Set()).committed.length === 3);

// Campaign scope is a disclosed category LIST, never a regex over free text.
const campCats = CS.catKeys(['Marketing', 'Music Video']);
assert('campaign scope matches a category exactly, case- and space-insensitively',
  CS.inScope(' marketing ', campCats) && CS.inScope('Music Video', campCats));
assert('scope does NOT sweep in free text that merely contains a scoped word',
  !CS.inScope('Social Security', campCats) && !CS.inScope('Public Relations', campCats));
assert('(no song) is a real bucket key, not an absence',
  CS.songKeyOf('') === '__no_song__' && CS.songKeyOf('  Intro ') === 'intro');
assert('best spelling is most-used, ties alphabetically',
  CS.bestOf(new Map([['zeke bleu', 1], ['Zeke Bleu', 3]])) === 'Zeke Bleu'
  && CS.bestOf(new Map([['B', 2], ['A', 2]])) === 'A');

// ── Ad allocation arithmetic (lib/adAllocate.js) ─────────────────────────────
const AD = require('../lib/adAllocate');
assert('apportion sums EXACTLY — $422.00 three ways is not $422.01',
  AD.apportion(42200, [1, 1, 1]).reduce((a, b) => a + b, 0) === 42200);
assert('the residue is PLACED, largest remainder first, deterministic on ties',
  AD.apportion(50000, [1, 1, 1]).join(',') === '16667,16667,16666');
assert('apportion is weight-proportional and still exact',
  AD.apportion(10000, [70, 30]).join(',') === '7000,3000'
  && AD.apportion(10001, [1, 1]).reduce((a, b) => a + b, 0) === 10001);
assert('zero weights split evenly rather than losing the money',
  AD.apportion(1000, [0, 0, 0]).reduce((a, b) => a + b, 0) === 1000);
assert('drawing is greedy oldest-first, whole charges before the next',
  AD.drawFromCharges([{ id: 1, remaining_cents: 3000 }, { id: 2, remaining_cents: 9000 }], 5000)
    .slices.map(s => `${s.id}:${s.cents}`).join(',') === '1:3000,2:2000');
const drawn = AD.drawMany(
  [{ id: 1, remaining_cents: 5000 }, { id: 2, remaining_cents: 5000 }],
  [{ campaign_id: 10, cents: 6000 }, { campaign_id: 11, cents: 6000 }]);
assert('drawMany is SEQUENTIAL — the sum of all slices can never exceed the month',
  drawn.total === 10000 && drawn.short_total === 2000);
assert('a request the month could not fund is NAMED, not silently trimmed',
  drawn.plan[1].short === 2000 && drawn.plan[1].requested === 6000);
const chargesIn = [{ id: 1, remaining_cents: 5000 }];
AD.drawMany(chargesIn, [{ campaign_id: 1, cents: 5000 }]);
assert('drawMany never mutates the caller’s charge listing',
  chargesIn[0].remaining_cents === 5000);
const adFam = AD.familySlices(50000, [{ campaign_id: 1, artist: 'A', song: null, cents: 20000 }]);
assert('the unallocated remainder LEADS, so the pool row keeps the parent identity',
  adFam.remainder === 30000 && adFam.slices[0].allocated === false && adFam.slices[0].cents === 30000);
assert('a family always sums to the charge, to the cent',
  adFam.slices.reduce((s, x) => s + x.cents, 0) === 50000);
assert('a fully allocated charge yields no leading remainder slice',
  AD.familySlices(50000, [{ campaign_id: 1, artist: 'A', cents: 50000 }]).slices.length === 1);
assert('over-allocating THROWS rather than writing a family that does not add up',
  (() => { try { AD.familySlices(100, [{ campaign_id: 1, artist: 'A', cents: 200 }]); return false; } catch { return true; } })());

// ── Label-level (ad pool) rules: EQUALITY, never substring ───────────────────
const LL = require('../lib/labelLevel');
const llRules = LL.rulesFrom([
  { scope: 'vendor', rule_key: '  Meta   Platforms ' },
  { scope: 'category', rule_key: 'Advertisements' },
]);
assert('a vendor rule matches the WHOLE payee, whitespace-collapsed',
  llRules.has('meta platforms', 'Marketing') && llRules.has('Meta  Platforms', 'Anything'));
assert('a vendor rule is not a substring rule — "Meta Platforms Ireland" is a different vendor',
  !llRules.has('Meta Platforms Ireland', 'Marketing'));
assert('a category rule answers for everything in it, whatever the payee',
  llRules.has('Some Agency', 'advertisements'));
assert('no rules means no pool — the page says so rather than inventing one',
  LL.rulesFrom([]).size === 0 && !LL.rulesFrom([]).has('Meta Platforms', 'Marketing'));

// ── Bulk deals: contracted vs delivered vs paid ──────────────────────────────
// These are the rules a vendor argument turns on ("we delivered everything" /
// "you still owe us"), so they get held here rather than living only in a page.
const BD = require('../lib/bulkDeals');
const DAY = 86400000;
const NOW = Date.parse('2026-09-01T12:00:00Z');
const deal = (o) => ({
  amount: 1000, combined_amount: null, currency: 'USD', payment_status: 'Unpaid',
  bulk_deal_quantity: null, bulk_deal_unit: 'videos', bulk_deal_completed: 0,
  bulk_deal_archived: false, total_items: 0, completed_items: 0, last_delivery_at: null,
  installments_paid: 0, installment_count: 0, status_paid_total: 0,
  invoice_date: '2026-08-30', ...o,
});

assert('contracted quantity BEATS a shorter logged checklist — 2 logged of 10 bought is not 100%',
  BD.contractedOf(deal({ bulk_deal_quantity: 10, total_items: 2 })) === 10);
assert('a longer checklist than the contract wins — you cannot un-deliver what arrived',
  BD.contractedOf(deal({ bulk_deal_quantity: 3, total_items: 5 })) === 5);
assert('checklist rows are the delivered figure once ANY exist',
  BD.deliveredOf(deal({ total_items: 4, completed_items: 1, bulk_deal_completed: 9 })) === 1);
assert('with no checklist, the campaigns INT count is the fallback (same precedence the campaign page renders)',
  BD.deliveredOf(deal({ total_items: 0, bulk_deal_completed: 3 })) === 3);

assert('installments are the paid figure when they exist — status is NOT added on top',
  BD.paidOf(deal({ payment_status: 'Paid', installment_count: 2, installments_paid: 400, status_paid_total: 1000 })).paid === 400);
assert('with no installments, the family status sum is the paid figure',
  BD.paidOf(deal({ payment_status: 'Paid', status_paid_total: 1000 })).paid === 1000);
assert('paid is clamped to the family total — an overpayment is a reconciliation bug, not 130% pressure',
  BD.paidOf(deal({ installment_count: 1, installments_paid: 1300 })).pct === 100);
assert('a split family is measured against parent + children, not the parent slice',
  BD.paidOf(deal({ amount: 400, combined_amount: 1000, status_paid_total: 500 })).pct === 50);

assert('paid-ahead needs a 25-point gap AND unfinished delivery',
  BD.deriveDeal(deal({ bulk_deal_quantity: 4, total_items: 4, completed_items: 1, status_paid_total: 1000, payment_status: 'Paid' }), NOW).paid_ahead === true);
assert('a 100%-delivered deal is never paid-ahead however early the money went out',
  BD.deriveDeal(deal({ bulk_deal_quantity: 4, total_items: 4, completed_items: 4, status_paid_total: 1000, payment_status: 'Paid' }), NOW).paid_ahead === false);

assert('stalled needs MONEY OUT — an unpaid late deal is an AP question, not a delivery risk',
  BD.stalledOf(deal({ invoice_date: new Date(NOW - 90 * DAY).toISOString(), bulk_deal_quantity: 5 }), NOW).stalled === false);
assert('paid + under-delivered + nothing received in 30 days = stalled',
  BD.stalledOf(deal({ invoice_date: new Date(NOW - 45 * DAY).toISOString(), bulk_deal_quantity: 5, status_paid_total: 1000, payment_status: 'Paid' }), NOW).stalled === true);
assert('a recent delivery resets the clock — last_delivery_at outranks invoice_date',
  BD.stalledOf(deal({ invoice_date: new Date(NOW - 200 * DAY).toISOString(), last_delivery_at: new Date(NOW - 3 * DAY).toISOString(), bulk_deal_quantity: 5, total_items: 5, completed_items: 1, status_paid_total: 1000, payment_status: 'Paid' }), NOW).stalled === false);
assert('29 days is not yet stalled — the boundary is 30',
  !BD.stalledOf(deal({ invoice_date: new Date(NOW - 29 * DAY).toISOString(), bulk_deal_quantity: 5, status_paid_total: 1000, payment_status: 'Paid' }), NOW).stalled);
assert('an ARCHIVED deal never alarms — archiving is the answer to the alarm',
  BD.stalledOf(deal({ bulk_deal_archived: true, invoice_date: new Date(NOW - 90 * DAY).toISOString(), bulk_deal_quantity: 5, status_paid_total: 1000, payment_status: 'Paid' }), NOW).stalled === false);

// The type collision that motivated bulk_deal_archived: a DELIVERED COUNT of 3
// must never be read as "archived". If these ever agree, the INT got coerced.
assert('a delivered-count of 3 does NOT archive the deal (bulk_deal_completed is an INT, not a flag)',
  BD.deriveDeal(deal({ bulk_deal_completed: 3, bulk_deal_quantity: 5 }), NOW).bulk_deal_archived === false);
assert('deriveDeal never writes bulk_deal_completed',
  BD.deriveDeal(deal({ bulk_deal_completed: 3 }), NOW).bulk_deal_completed === 3);

assert('per-unit cost is CONTRACTED rate while live, EFFECTIVE rate against what arrived',
  (() => { const d = BD.deriveDeal(deal({ bulk_deal_quantity: 10, total_items: 10, completed_items: 4, status_paid_total: 1000, payment_status: 'Paid' }), NOW);
    return d.unit_cost === 100 && d.effective_unit_cost === 250; })());
assert('a deal with no quantity and no items has no per-unit cost to invent',
  BD.deriveDeal(deal({}), NOW).unit_cost === null);
assert('singularUnit trims the plural for "$100/video"',
  BD.singularUnit('videos') === 'video' && BD.singularUnit('') === 'item');

// ── Recording budgets: qty × price, contingency on top, fund waterfall ───────
const RB = require('../lib/recordingBudget');

assert('a line item is qty × unit_price, rounded AT THE LINE',
  RB.lineAmount(3, 1500) === 4500 && RB.lineAmount('10', '1500.005') === 15000.05);
assert('a blank qty is zero, not one — an unfilled row contributes nothing',
  RB.lineAmount('', 1500) === 0 && RB.lineAmount(null, 1500) === 0);

const rbItems = [
  { section: 'producers', amount: RB.lineAmount(10, 1500) },
  { section: 'studio', amount: RB.lineAmount(6, 850) },
  { section: 'mixing_mastering', amount: RB.lineAmount(10, 300) },
];
const rbT = RB.budgetTotals(rbItems, 7.5);
assert('sections subtotal is the sum of already-rounded lines',
  rbT.sections_subtotal === 23100);
assert('contingency sits ON TOP of the subtotal, never inside it',
  rbT.contingency_amount === 1732.5 && rbT.total_budget === 24832.5);
assert('the six section totals sum to the subtotal — both slicings tie',
  RB.round2(Object.values(rbT.section_totals).reduce((a, b) => a + b, 0)) === rbT.sections_subtotal);
assert('every section is present even when empty — the sheet has six rows either way',
  RB.SECTIONS.every(k => rbT.section_totals[k] !== undefined) && rbT.section_totals.travel === 0);
assert('a zero contingency adds nothing (a legacy blank budget does not inflate)',
  RB.budgetTotals(rbItems, 0).total_budget === 23100 && RB.budgetTotals(rbItems, null).total_budget === 23100);
assert('an unknown section is summed into the subtotal but claims no section total',
  RB.budgetTotals([{ section: 'lasers', amount: 100 }], 0).sections_subtotal === 100);

const rbFund = RB.fundPanel({ fund_amount: 100000, advance_amount: 25000, total_budget: 24832.5, contingency_amount: 1732.5 });
assert('the advance comes out of the fund FIRST — available is fund minus advance',
  rbFund.recording_fund_available === 75000);
assert('balance due on delivery is what is left after the advance AND the plan',
  rbFund.balance_due_on_delivery === 50167.5);
assert('an overrunning plan reports a NEGATIVE balance rather than clamping to zero',
  RB.fundPanel({ fund_amount: 10000, advance_amount: 5000, total_budget: 9000 }).balance_due_on_delivery === -4000);

assert('a fund costs summary is fund − advance − spent, and never uses planned',
  (() => { const s = RB.costsSummary('fund', { fund_amount: 100000, advance_amount: 25000, planned: 24832.5, spent: 31000 });
    return s.remainder_after_advance === 75000 && s.balance_of_fund === 44000 && s.budget_planned === undefined; })());
assert('a budget costs summary is planned − spent, and never mentions the fund',
  (() => { const s = RB.costsSummary('budget', { fund_amount: 100000, advance_amount: 25000, planned: 24832.5, spent: 31000 });
    return s.remaining === -6167.5 && s.fund === undefined; })());
assert('every section maps to a default ledger category so a planned line always books somewhere',
  RB.SECTIONS.every(k => !!RB.SECTION_TO_DEFAULT_CATEGORY[k]));


// ── W9 name matching: lenient on form, strict on identity ────────────────────
// A badge everyone ignores is worse than no badge, so entity suffixes, name
// order, middle names and punctuation must NOT raise a mismatch — only a
// genuinely different party may.
const W9 = require('../lib/w9NameMatch');
assert('entity suffix + punctuation is the same company', W9.namesMatch('Smith LLC', 'Smith, L.L.C.'));
assert('name order does not change identity', W9.namesMatch('Jane Doe', 'Doe, Jane'));
assert('a middle initial on one side only is the same person', W9.namesMatch('Jane Doe', 'Jane Q. Doe'));
assert('& and "and" are the same word', W9.namesMatch('Bob & Sons Co', 'Bob and Sons'));
assert('accents fold', W9.namesMatch('Jose Diaz', 'Jos\u00e9 D\u00edaz'));
assert('a DIFFERENT surname is a real mismatch', !W9.namesMatch('Jane Doe', 'John Doe'));
assert('a different company is a real mismatch', !W9.namesMatch('Acme Records', 'Globex Media'));
assert('a blank name makes NO claim — not-yet-read is not a mismatch',
  W9.namesMatch('', 'Anything') && W9.namesMatch('Anything', null));
assert('mismatchOf reports both names so the operator can see which is wrong',
  (() => { const m = W9.mismatchOf('Acme Records', 'Globex Media'); return m.payee === 'Acme Records' && m.w9_name === 'Globex Media'; })());
assert('mismatchOf is null when they agree', W9.mismatchOf('Smith LLC', 'Smith Inc') === null);


console.log(process.exitCode ? '\nFIXTURES FAILED' : '\nAll fixtures pass.');

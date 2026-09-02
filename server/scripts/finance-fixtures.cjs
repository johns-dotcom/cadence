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

// ── FX date keys ─────────────────────────────────────────────────────────────
// node-pg returns a DATE column as a JS Date. The old `String(d).slice(0,10)`
// turned that into "Tue Sep 01": a cache key that never hits, a frankfurter URL
// that always 404s, and therefore a SILENT fall-through to the hardcoded
// fallback table for every unstamped foreign row in the app. Costed ~270ms per
// row too, because a failed fetch is never cached.
const { dateKey } = require('../lib/fx');
assert('dateKey: a pg Date becomes its own calendar day, not "Tue Sep 01"',
  dateKey(new Date(2026, 8, 1)) === '2026-09-01');
assert('dateKey: LOCAL components, never toISOString — pg parses DATE at local midnight',
  // 1 Jan local midnight is 31 Dec in UTC anywhere west of Greenwich;
  // toISOString() would report the wrong year, not just the wrong day.
  dateKey(new Date(2026, 0, 1)) === '2026-01-01');
assert('dateKey: an ISO timestamp string keeps its day', dateKey('2026-03-04T22:00:00Z') === '2026-03-04');
assert('dateKey: a plain day passes through', dateKey('2026-03-04') === '2026-03-04');
assert('dateKey: garbage means "latest", never a doomed HTTP round-trip',
  dateKey('Tue Sep 01') === null && dateKey(new Date('nope')) === null && dateKey('') === null && dateKey(null) === null);

// ── payment_status vocabulary ────────────────────────────────────────────────
// Three exact strings, compared exactly everywhere. Accepting a casing variant
// is fine; INVERTING it is not — a lowercase 'paid' used to fail an
// `includes()` test and be written as 'Unpaid'.
const { canonicalPaymentStatus, PAYMENT_STATUSES } = require('../lib/constants');
assert('payment_status: any casing canonicalizes',
  canonicalPaymentStatus('paid') === 'Paid' && canonicalPaymentStatus('  PARTIAL ') === 'Partial'
  && canonicalPaymentStatus('unpaid') === 'Unpaid');
assert('payment_status: absent is null (not supplied), never a silent Unpaid',
  canonicalPaymentStatus(undefined) === null && canonicalPaymentStatus('') === null);
assert('payment_status: an unknown value is REJECTED, not coerced',
  canonicalPaymentStatus('settled') === false && canonicalPaymentStatus('Pd') === false);
assert('payment_status: the vocabulary is exactly the three the SQL compares against',
  PAYMENT_STATUSES.join('|') === 'Unpaid|Partial|Paid');

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



// ── Vendor surfaces: added expenses, duplicate pairs, the unified rollup ────
// The added-expense population is the one with NO invoice number, so the
// duplicate-invoice gate cannot see it — these rules are the only thing
// standing between a creator and being paid twice.
const VS = require('../lib/vendorSurfaces');
const VD = require('../lib/vendorDupes');

assert("added-expense sources use cadence's SINGULAR 'recoupment'",
  VS.ADDED_SOURCES.includes('recoupment') && VS.ADDED_SOURCES.includes('artist_campaigns'));

const added = VS.addedExpenseRollup([
  { id: 1, payee: 'Jae Films', amount: 500, currency: 'USD', usd: 500, artist: 'Nova', spent_date: '2026-03-01' },
  { id: 2, payee: 'jae  films!', amount: 500, currency: 'USD', usd: 500, artist: 'Nova', spent_date: '2026-03-05' },
  { id: 3, payee: 'Jae Films', amount: 500, currency: 'EUR', usd: 540, artist: 'Nova', spent_date: '2026-03-02' },
  { id: 4, payee: 'Jae Films', amount: 500, currency: 'USD', usd: 500, artist: 'n/a', spent_date: '2026-06-01' },
  { id: 5, payee: 'Solo Vendor', amount: 9000, currency: 'USD', usd: 9000, artist: '', spent_date: null },
]);
assert('spelling variants bucket together on the canonical strip-all key',
  added.vendors.find((v) => v.key === 'jaefilms').items === 4);
assert('the display name is the most-common spelling, not the first seen',
  added.vendors.find((v) => v.key === 'jaefilms').name === 'Jae Films');
assert('per-currency totals stay separate; the USD column is the only merged one',
  (() => { const v = added.vendors.find((x) => x.key === 'jaefilms');
    return v.totals.USD === 1500 && v.totals.EUR === 500 && v.usd === 2040; })());
assert('same amount within the window is a suspected double entry',
  added.dupePairs.some((p) => p.a.id === 1 && p.b.id === 2 && p.days_apart === 4));
assert('a duplicate card is headed with the most-common spelling, not the first seen',
  added.dupePairs.every((p) => p.payee === 'Jae Films'));
assert('the same amount in a DIFFERENT currency is not a duplicate',
  !added.dupePairs.some((p) => [p.a.id, p.b.id].includes(3)));
assert('the same amount six weeks apart is not a duplicate',
  !added.dupePairs.some((p) => [p.a.id, p.b.id].includes(4)));
assert('an undated row makes no duplicate claim rather than a false one',
  !added.dupePairs.some((p) => [p.a.id, p.b.id].includes(5)));
assert('a placeholder artist is not counted as an artist on the vendor',
  added.vendors.find((v) => v.key === 'jaefilms').artists.join() === 'Nova');
assert('spend bands are fixed USD thresholds (ok < 1000 <= watch < 5000 <= high)',
  VS.bandFor(999) === 'ok' && VS.bandFor(1000) === 'watch' && VS.bandFor(5000) === 'high');
assert('name variants only list buckets with more than one spelling',
  added.nameVariants.length === 1 && added.nameVariants[0].spellings.length === 2);

assert('identical once normalized is the exact tier', VD.scorePair('ACME Records', 'acme  records!').tier === 'exact');
assert('one name plus extra words scores high', VD.scorePair('Venable', 'Venable LLP').tier === 'high');
assert('a bare entity suffix never pairs by containment',
  VD.scorePair('LLC', 'Sunset Sound LLC') === null);
assert('two different companies do not pair', VD.scorePair('Acme Records', 'Globex Media') === null);
assert('the pair key is order-independent', VD.pairKey('A Co', 'B Co') === VD.pairKey('b co', 'a co'));
const dupVendors = [
  { payee: 'Acme Records', invoice_count: 9, has_w9: true, first_invoice: '2024-01-01', total_usd: 9000 },
  { payee: 'ACME  Records', invoice_count: 2, has_w9: false, first_invoice: '2025-01-01', total_usd: 500 },
  { payee: 'Globex Media', invoice_count: 4, has_w9: false, first_invoice: '2025-01-01', total_usd: 400 },
];
assert('the busiest, W9-bearing spelling is the one that survives',
  VD.vendorDupePairs(dupVendors)[0].keep.payee === 'Acme Records');
assert('a pair already linked by an alias never comes back',
  VD.vendorDupePairs(dupVendors, { aliased: new Set([VD.pairKey('Acme Records', 'ACME  Records')]) }).length === 0);
assert('a pair marked "not duplicates" never comes back',
  VD.vendorDupePairs(dupVendors, { acked: new Set([VD.pairKey('Acme Records', 'ACME  Records')]) }).length === 0);

const uni = VS.unifiedRows([
  { payee: 'Acme', is_root: true, usd: 600, artist: 'Nova', has_invoice: true, payment_status: 'Paid', bank_evidence: null, bank_expected: true, last_activity: '2026-03-01', category: 'Marketing' },
  { payee: 'Acme', is_root: false, usd: 400, artist: 'Nova', has_invoice: true, payment_status: 'Paid', bank_evidence: null, bank_expected: true, last_activity: '2026-03-01', category: 'Marketing' },
  { payee: 'Acme', is_root: true, usd: 100, artist: '', has_invoice: false, payment_status: 'Unpaid', bank_evidence: null, bank_expected: false, last_activity: '2026-04-01', category: 'PR' },
], [
  { key: 'acme', name: 'ACME CORP', n: 2, total: 1130, last_seen: '2026-04-02', resolved_vendor: 'Acme' },
  { key: 'whoisthis', name: 'SQ *WHO', n: 1, total: 75, last_seen: '2026-04-03', resolved_vendor: null },
]);
const acme = uni.rows[0];
assert('a split slice adds money but is NOT a second invoice',
  acme.invoices === 2 && acme.invoiced_usd === 1100);
assert('needs-matching counts only the discrepancy state (paid, expected, no line)',
  acme.needs_matching === 1);
assert('a blank artist is a worklist item; a named one is not', acme.needs_artist === 1);
assert('to-attach counts invoices with no document', acme.to_attach === 1);
assert('the bank delta is bank-out minus invoiced, and a wire fee is inside tolerance',
  acme.delta === 30 && acme.in_tolerance === true);
assert('a descriptor naming nobody is a queue item, never a vendor row',
  uni.unlinked.length === 1 && uni.rows.length === 1);
assert('no bank activity makes NO tolerance claim rather than a false tick',
  VS.unifiedRows([{ payee: 'Solo', is_root: true, usd: 10, artist: 'X', has_invoice: true, payment_status: 'Unpaid' }], []).rows[0].in_tolerance === null);

// The vendor directory converts per (currency, locked rate) bucket. The rule
// that matters is the one the old SQL broke: an unstamped foreign invoice must
// NOT pass through at face value.
assert('a locked rate always wins over the live rate', usdOf(1000, 'EUR', 0.5) === 2000);
assert('an unstamped foreign amount is not silently 1:1',
  (() => { const { getCachedRates } = require('../lib/fx');
    const rates = getCachedRates(); rates.JPY = 100;
    return usdOf(10000, 'JPY', null) === 100; })());

// ── Drill-row documents: the file hangs off the FAMILY, not the slice ────────
// A split payment is one family. The invoice is on the root; the P&L drills
// into the slices. Resolving to the slice id would 404 and the row would claim
// "no document" for a payment that plainly has one.
const DD = require('../lib/drillDocs');
const slice = { invoice_entry_id: 45, invoice_filename: 'gate-three.pdf', proof_entry_id: 87, proof_filename: 'proof.png' };
assert('a slice inherits the ROOT entry that holds the invoice',
  DD.docsOf(slice)[0].entry_id === 45 && DD.docsOf(slice)[0].type === 'invoice');
assert('a slice carrying its OWN copy keeps its own entry id',
  DD.docsOf(slice)[1].entry_id === 87 && DD.docsOf(slice)[1].type === 'proof');
assert('preference order is invoice → proof → receipt → W-9',
  DD.docsOf({ w9_entry_id: 1, receipt_entry_id: 2, proof_entry_id: 3, invoice_entry_id: 4 })
    .map((d) => d.type).join(',') === 'invoice,proof,receipt,w9');
assert('a row with nothing attached offers no button at all',
  DD.docsOf({ invoice_filename: 'ghost.pdf' }).length === 0 && DD.docsOf(null).length === 0);
assert('a missing filename never fabricates one', DD.docsOf({ receipt_entry_id: 9 })[0].filename === null);
assert('every declared type is selected and labelled — no half-wired document type',
  DD.DOC_TYPES.every((t) => DD.DOC_LABELS[t] && DD.docSelect().includes(`AS ${t}_entry_id`) && DD.docSelect().includes(`AS ${t}_filename`)));

// ── Financials month drill: one anchor, and a second basis kept separate ────
// The month page is opened from a monthly-rollup row. Anchor it anywhere but
// the intake cohort and the page header contradicts the number that was
// clicked. Cash out is deliberately a DIFFERENT set (payment-date basis) and
// must never be folded into the cohort.
const FE = require('../lib/financeExec');
const sl = (o) => ({ root_id: o.root_id, usd: o.usd, paid: !!o.paid, paid_on: o.paid_on || null,
  received_on: o.received_on, artist: o.artist ?? null, category: o.category ?? null,
  payee: o.payee ?? null, invoice_number: o.invoice_number ?? null,
  payment_status: o.paid ? 'Paid' : 'Unpaid' });
const monthSlices = [
  // Two slices of ONE split family — the cohort counts the money twice over,
  // the invoice count once.
  sl({ root_id: 1, usd: 60, received_on: '2026-06-03', paid: true, paid_on: '2026-06-20', artist: 'Zeke Bleu', category: 'Marketing', payee: 'Acme' }),
  sl({ root_id: 1, usd: 40, received_on: '2026-06-03', paid: true, paid_on: '2026-06-20', artist: 'Nova Ray', category: 'Marketing', payee: 'Acme' }),
  sl({ root_id: 2, usd: 25, received_on: '2026-06-11', paid: false, artist: 'Zeke Bleu', category: 'Travel', payee: 'Beta' }),
  // Landed in June, paid in JULY — in the cohort, not in June's cash out.
  sl({ root_id: 3, usd: 10, received_on: '2026-06-30', paid: true, paid_on: '2026-07-02', artist: '', category: '', payee: '' }),
  // Landed in MAY, paid in June — June cash out, not June's cohort.
  sl({ root_id: 4, usd: 500, received_on: '2026-05-09', paid: true, paid_on: '2026-06-15', artist: 'Ezra', category: 'Advance', payee: 'Gamma' }),
];
const jun = FE.foldMonth(monthSlices, '2026-06');
assert('month drill: paid + open = received by construction',
  round2(jun.summary.paid_usd + jun.summary.unpaid_usd) === jun.summary.received_usd && jun.summary.received_usd === 135);
assert('month drill: a split family is ONE invoice, both slices of money',
  jun.summary.invoice_count === 3 && jun.summary.received_usd === 135 && jun.summary.avg_invoice_usd === 45);
assert('month drill: cash out is the payment-date basis, not the cohort',
  jun.summary.cash_out_usd === 600 && jun.summary.cash_out_count === 2
  && jun.summary.cash_out_usd !== jun.summary.paid_usd);
assert('month drill: the cohort splits by CURRENT status, not by when it was paid',
  jun.summary.paid_usd === 110 && jun.summary.unpaid_usd === 25);
assert('month drill: every slicing of the month ties to the header total',
  round2(jun.artists.reduce((t, a) => t + a.total_usd, 0)) === jun.summary.received_usd
  && round2(jun.categories.reduce((t, c) => t + c.total_usd, 0)) === jun.summary.received_usd
  && round2(jun.days.reduce((t, d) => t + d.received_usd, 0)) === jun.summary.received_usd
  && round2(jun.vendors.reduce((t, v) => t + v.total_usd, 0)) === jun.summary.received_usd);
assert('month drill: an artist category mix ties to that artist row',
  jun.artists.every((a) => round2(a.categories.reduce((t, c) => t + c.total_usd, 0)) === a.total_usd));
assert('month drill: unattributed money stays visible as its own row, uncounted as an artist',
  jun.artists.some((a) => a.key === null && a.label === 'Unassigned' && a.total_usd === 10) && jun.summary.artist_count === 2);
assert('month drill: split slices roll back up to the billed invoice',
  jun.top_invoices[0].root_id === 1 && jun.top_invoices[0].usd === 100 && jun.top_invoices[0].artist === '2 artists');
assert('month drill: prior month is the delta baseline, on both bases',
  jun.prior.month === '2026-05' && jun.prior.received_usd === 500 && jun.prior.cash_out_usd === 0);
assert('month drill: a foreign slice is never re-converted — usd arrives rounded at the row',
  FE.foldMonth([sl({ root_id: 9, usd: 33.33, received_on: '2026-06-02', paid: false })], '2026-06').summary.received_usd === 33.33);
assert('month drill: every day of the month emits a bar, quiet ones included',
  jun.days.length === 30 && FE.foldMonth([], '2026-02').days.length === 28 && FE.foldMonth([], '2024-02').days.length === 29);
assert('month drill: month-hop crosses the year boundary without special-casing',
  FE.shiftMonth('2026-01', -1) === '2025-12' && FE.shiftMonth('2026-12', 1) === '2027-01');
assert('month drill: a malformed month is refused, never coerced',
  ['2026-13', '2026-9', '', 'abc', '1999-01'].every((bad) => {
    try { FE.foldMonth([], bad); return false; } catch (e) { return e.status === 400; }
  }));

// ── Bookkeeper Reconcile — vendor NAME tiers, kept off the bank matcher ─────
// lib/vendorMatch.js exists because lib/bankReconcile.js is calibrated for bank
// DESCRIPTORS and held by the assertions above. These two must never be folded
// together: retuning one to satisfy the other retunes a matcher that is live on
// money. The tiers below are about legal suffixes, parenthetical asides and
// reordered words — a human's typed vendor name, not a card descriptor.
const VM = require('../lib/vendorMatch');
assert('vendor tiers: identical is 1.0 and says so',
  VM.vendorsMatch('Acme Co', 'acme co').score === 1.0 && VM.vendorsMatch('Acme Co', 'ACME CO').tier === 'exact');
assert('vendor tiers: a parenthetical aside does not make a new vendor',
  VM.vendorsMatch('10FIFTY LLC (UKG CENTRAL)', '10Fifty LLC').tier === 'parentheticals');
assert('vendor tiers: legal suffixes are noise',
  VM.vendorsMatch('Acme Co.', 'Acme Company LLC').match && VM.vendorsMatch('Acme Co.', 'Acme Company LLC').tier === 'suffixes');
assert('vendor tiers: a lost space is still the same name',
  VM.vendorsMatch('KYRAJOHNSON', 'Kyra Johnson').match);
assert('vendor tiers: reordered words match, strangers do not',
  VM.vendorsMatch('Jane M Doe', 'Doe Jane M').match && !VM.vendorsMatch('Jane Doe', 'Robert Smith').match);
assert('vendor tiers: a 3-letter fragment is a coincidence, not containment',
  !VM.vendorsMatch('Neo', 'Neon Media Group').match);
assert('vendor tiers: an empty side never matches anything',
  !VM.vendorsMatch('', 'Acme').match && VM.vendorsMatch('Acme', null).tier === 'empty');
assert('vendor tiers: every tier carries a plain-English label for the report',
  Object.keys(VM.TIERS).every((t) => typeof VM.TIERS[t] === 'string' && VM.TIERS[t].length > 3));
assert('vendor tiers: exact outranks every fuzzy tier, so the best candidate wins',
  VM.vendorsMatch('Acme Co', 'Acme Co').score > VM.vendorsMatch('Acme Co', 'Acme Co LLC').score);

// ── Bookkeeper Reconcile — the diff itself ──────────────────────────────────
const LD = require('../lib/ledgerDiff');
const bk = (o) => ({ sheet: o.sheet || '2026', rowNum: o.rowNum || 7, vendor: o.vendor ?? '', invoice: o.invoice ?? '',
  payee_name: o.payee_name ?? null, amount: o.amount ?? null, paid_date: o.paid_date ?? null,
  paid_amount: o.paid_amount ?? null, invoice_date: o.invoice_date ?? null, artist: o.artist ?? null });
const led = (o) => ({ id: o.id, payee: o.payee, invoice_number: o.invoice_number, amount: o.amount,
  family_amount: o.family_amount ?? o.amount, currency: o.currency || 'USD', usd: o.usd ?? o.amount,
  invoice_date: o.invoice_date || '2026-06-01', payment_date: o.payment_date || null,
  payment_status: o.payment_status || 'Unpaid', artist: o.artist || null });

assert('reconcile: "#0011" and "INV-11" are the same invoice number',
  LD.diffLedger([bk({ vendor: 'Acme Co', invoice: '#0011', amount: 100 })],
    [led({ id: 1, payee: 'Acme Co', invoice_number: 'INV-11', amount: 100 })]).counts.matched === 1);
assert('reconcile: a split invoice is compared at the FULL billed amount',
  LD.diffLedger([bk({ vendor: 'Acme Co', invoice: '11', amount: 100 })],
    [led({ id: 1, payee: 'Acme Co', invoice_number: '11', amount: 60, family_amount: 100 })]).counts.matched === 1
  && LD.diffLedger([bk({ vendor: 'Acme Co', invoice: '11', amount: 60 })],
    [led({ id: 1, payee: 'Acme Co', invoice_number: '11', amount: 60, family_amount: 100 })]).counts.amount_mismatch === 1);
assert('reconcile: a cent of drift is rounding, two cents is a disagreement',
  LD.diffLedger([bk({ vendor: 'A', invoice: '1', amount: 100.01 })], [led({ id: 1, payee: 'A', invoice_number: '1', amount: 100 })]).counts.matched === 1
  && LD.diffLedger([bk({ vendor: 'A', invoice: '1', amount: 100.02 })], [led({ id: 1, payee: 'A', invoice_number: '1', amount: 100 })]).counts.amount_mismatch === 1);
assert('reconcile: a same-number DIFFERENT-vendor hit is a collision, and it claims nothing',
  (() => {
    const r = LD.diffLedger([bk({ vendor: 'Beta Films', invoice: '11', amount: 100 })],
      [led({ id: 1, payee: 'Acme Co', invoice_number: '11', amount: 100 })], { sheetYears: [2026] });
    // The bookkeeper row is unmatched AND the ledger row still surfaces — a
    // silent claim would hide a real gap on both sides at once.
    return r.counts.missing_from_ledger === 1 && r.counts.missing_from_bookkeeper === 1;
  })());
assert('reconcile: one row lands in exactly ONE bucket, strongest signal first',
  (() => {
    const r = LD.diffLedger([bk({ vendor: 'Acme Company', invoice: '11', amount: 90, paid_date: '2026-06-02' })],
      [led({ id: 1, payee: 'Acme Co LLC', invoice_number: '11', amount: 100, payment_status: 'Unpaid' })]);
    return r.counts.amount_mismatch === 1 && r.diffs.length === 1 && r.diffs[0].issues.length >= 3;
  })());
assert('reconcile: paid-status disagreement outranks a paid-date one',
  LD.diffLedger([bk({ vendor: 'A', invoice: '1', amount: 100, paid_date: '2026-06-02' })],
    [led({ id: 1, payee: 'A', invoice_number: '1', amount: 100, payment_status: 'Unpaid' })]).counts.paid_status_mismatch === 1);
assert('reconcile: paid dates are only compared when both sides agree it is paid',
  LD.diffLedger([bk({ vendor: 'A', invoice: '1', amount: 100, paid_date: '2026-06-02' })],
    [led({ id: 1, payee: 'A', invoice_number: '1', amount: 100, payment_status: 'Paid', payment_date: '2026-06-05' })]).counts.paid_date_mismatch === 1);
assert('reconcile: a matched row with only a spelling difference is LOW, not a money problem',
  LD.diffLedger([bk({ vendor: 'Acme Company LLC', invoice: '1', amount: 100 })],
    [led({ id: 1, payee: 'Acme Co', invoice_number: '1', amount: 100 })]).counts.vendor_name_variation === 1);
assert('reconcile: a row with no invoice number is reported, never guessed at',
  (() => {
    const r = LD.diffLedger([bk({ vendor: 'A', invoice: '', amount: 100 })], []);
    return r.counts.no_invoice_num === 1 && r.diffs[0].ledger === null;
  })());
assert('reconcile: "0" is not an invoice number on either side',
  LD.diffLedger([bk({ vendor: 'A', invoice: '0', amount: 5 })], [led({ id: 1, payee: 'A', invoice_number: '000', amount: 5 })]).counts.no_invoice_num === 1);
assert('reconcile: the reverse direction is capped by the workbook years and the week ending',
  (() => {
    const rows = [
      led({ id: 1, payee: 'A', invoice_number: '1', amount: 10, invoice_date: '2019-01-01' }),  // before their engagement
      led({ id: 2, payee: 'B', invoice_number: '2', amount: 20, invoice_date: '2026-08-01' }),  // after their snapshot
      led({ id: 3, payee: 'C', invoice_number: '3', amount: 30, invoice_date: '2026-05-01' }),  // genuinely missing
    ];
    const r = LD.diffLedger([], rows, { sheetYears: [2026], weekEnding: '2026-06-30' });
    return r.counts.missing_from_bookkeeper === 1
      && r.diffs[0].ledger.id === 3
      && r.suppressed.outside_sheet_years === 1 && r.suppressed.after_week_ending === 1;
  })());
assert('reconcile: with no year inferrable the filter falls OPEN rather than hiding rows',
  LD.diffLedger([], [led({ id: 1, payee: 'A', invoice_number: '1', amount: 10, invoice_date: '2019-01-01' })], {}).counts.missing_from_bookkeeper === 1);
assert('reconcile: amounts are compared native to native — a foreign row is never converted first',
  (() => {
    const r = LD.diffLedger([bk({ vendor: 'Euro Co', invoice: '1', amount: 100 })],
      [led({ id: 1, payee: 'Euro Co', invoice_number: '1', amount: 100, currency: 'EUR', usd: 200 })]);
    return r.counts.matched === 1;   // 100 EUR filed vs 100 EUR billed is agreement
  })());
assert('reconcile: a currency difference is disclosed rather than silently blamed on the vendor',
  LD.diffLedger([bk({ vendor: 'Euro Co', invoice: '1', amount: 120 })],
    [led({ id: 1, payee: 'Euro Co', invoice_number: '1', amount: 100, currency: 'EUR', usd: 200 })])
    .diffs[0].issues.some((i) => /EUR/.test(i) && /unit difference/.test(i)));
assert('reconcile: money at stake means the GAP on a mismatch and the WHOLE row when one side is blind',
  (() => {
    const gap = LD.rowDollarDelta({ kind: 'amount_mismatch', bookkeeper: { amount: 90 }, ledger: { family_amount: 100, usd: 100 } });
    const whole = LD.rowDollarDelta({ kind: 'missing_from_bookkeeper', bookkeeper: null, ledger: { family_amount: 100, usd: 250 } });
    const clean = LD.rowDollarDelta({ kind: 'matched', bookkeeper: { amount: 100 }, ledger: { family_amount: 100, usd: 100 } });
    return gap === 10 && whole === 250 && clean === 0;   // USD-equivalent where the ledger has one
  })());
assert('reconcile: every category is counted, and clean rows sink to the end of the report',
  LD.CATEGORY_KEYS.length === 8 && LD.CATEGORY_KEYS[LD.CATEGORY_KEYS.length - 1] === 'matched'
  && LD.DIFF_CATEGORIES.every((c) => c.label && c.action && c.priority));

// ── Bookkeeper Reconcile — reading someone else's workbook ──────────────────
// These build an in-memory ExcelJS workbook (no file, no DB) shaped like the
// real thing: a title block, a WEEK ENDING line, a BLANK row, a header that is
// not row 1, and a two-row PAID sub-header.
const XL = require('exceljs');
const LDX = require('../lib/ledgerDiffXlsx');
const bkWorkbook = (extraRows = []) => {
  const wb = new XL.Workbook();
  const ws = wb.addWorksheet('2026');
  ws.addRow(['OUTSTANDING INVOICES SUMMARY']);
  ws.addRow(['WEEK ENDING', '2026-06-30']);
  ws.addRow([]);                                    // the blank row that matters
  ws.addRow(['VENDOR', 'INVOICE #', 'AMOUNT', 'PAID', '']);
  ws.addRow(['', '', '', 'DATE', 'AMOUNT']);        // merged-parent sub-header
  ws.addRow(['Acme Co', 'INV-1', '$1,200.00', '2026-06-02', 1200]);
  ws.addRow(['Beta LLC', '#2', '(500.00)', '', '']);
  for (const r of extraRows) ws.addRow(r);
  wb.addWorksheet('SUM').addRow(['TOTALS']);
  return wb;
};
const parsed = LDX.parseBookkeeperWorkbook(bkWorkbook([['Gamma', '3', 900, '', '']]));
assert('workbook: a BLANK row above the data does not eat the last data row',
  // ExcelJS actualRowCount is a COUNT of non-empty rows and rowCount is the
  // highest row NUMBER. Using the count as an upper bound silently drops one
  // trailing row per blank row above it. This caught it live.
  parsed.rows.length === 3 && parsed.rows[2].vendor === 'Gamma' && parsed.rows[2].rowNum === 8);
assert('workbook: the header is found under a title block, not assumed to be row 1',
  parsed.rows[0].rowNum === 6 && parsed.rows[0].vendor === 'Acme Co');
assert('workbook: a two-row PAID block is read as paid date + paid amount',
  parsed.rows[0].paid_date === '2026-06-02' && parsed.rows[0].paid_amount === 1200);
assert('workbook: accounting formats parse — currency symbols, commas, parens-as-negative',
  parsed.rows[0].amount === 1200 && parsed.rows[1].amount === -500);
assert('workbook: summary / totals tabs are skipped with a stated reason',
  parsed.sheets_skipped.length === 1 && parsed.sheets_skipped[0].sheet === 'SUM' && parsed.sheets_skipped[0].reason.length > 10);
assert('workbook: the WEEK ENDING snapshot and the tab year are both picked up',
  parsed.week_ending === '2026-06-30' && parsed.sheet_years.join() === '2026');
assert('workbook: a sheet with no usable header is reported, never half-read',
  (() => {
    const wb = new XL.Workbook();
    wb.addWorksheet('Notes').addRow(['just some prose about the month']);
    const p = LDX.parseBookkeeperWorkbook(wb);
    return p.rows.length === 0 && p.sheets_skipped.length === 1;
  })());

console.log(process.exitCode ? '\nFIXTURES FAILED' : '\nAll fixtures pass.');

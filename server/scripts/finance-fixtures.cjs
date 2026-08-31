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
const { excludeBankRows, isCreatorRow, reportingThresholdFor } = require('../lib/ledgerSource');

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

console.log(process.exitCode ? '\nFIXTURES FAILED' : '\nAll fixtures pass.');

// No-DB smoke test for the reconciliation pure logic + statement-month rule.
// Run: node server/scripts/smoke-reconcile.js
const R = require('../lib/bankReconcile');
const { statementMonthFor } = require('../lib/statementMonth');
const { normalizeInvoiceNum } = require('../lib/normalizeInvoiceNum');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  FAIL ${name}\n    got  ${g}\n    want ${w}`); };
};
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name}`); } };

console.log('statementMonthFor (UTC, day>=21 rolls next month)');
eq('day 20 stays', statementMonthFor('2026-03-20T12:00:00Z'), '2026-03');
eq('day 21 rolls', statementMonthFor('2026-03-21T12:00:00Z'), '2026-04');
eq('dec 22 rolls to jan next yr', statementMonthFor('2026-12-22T12:00:00Z'), '2027-01');
eq('day 1', statementMonthFor('2026-06-01T00:00:00Z'), '2026-06');
eq('invalid → null', statementMonthFor('not-a-date'), null);

console.log('parsePipeLines');
const pipe = R.parsePipeLines([
  'DATE|DIRECTION|AMOUNT|PAYEE|REFERENCE|DESCRIPTION',   // header, skipped
  '2026-03-05|debit|1,250.00|Acme Studios|WIRE123|Wire to Acme',
  '03/06/2026|credit|500|Refund Co||Refund',
  '# comment line',
  'garbage',
].join('\n'));
eq('pipe count', pipe.length, 2);
eq('pipe row1 amount', pipe[0].amount, 1250);
eq('pipe row1 dir', pipe[0].direction, 'debit');
eq('pipe row1 payee', pipe[0].payee_guess, 'Acme Studios');
eq('pipe row2 date norm', pipe[1].txn_date, '2026-03-06');
eq('pipe row2 credit', pipe[1].direction, 'credit');

console.log('parseCsv — BofA-style (Date/Description/Amount, signed)');
const bofa = R.parseCsv([
  'Some Bank', 'Account summary block', '',
  'Date,Description,Amount,Running Bal.',
  '03/05/2026,"WIRE TRANSFER BNF: ACME STUDIOS LLC REF 998",-1250.00,10000.00',
  '03/06/2026,"CHECKCARD 0304 SPOTIFY STOCKHOLM",-9.99,9990.01',
  '03/07/2026,"ZELLE PAYMENT TO JANE DOE",-200.00,9790.01',
  '03/08/2026,"DEPOSIT",5000.00,14790.01',
].join('\n'), 'bofa');
eq('csv count', bofa.length, 4);
eq('csv wire debit', bofa[0].direction, 'debit');
eq('csv wire amount abs', bofa[0].amount, 1250);
eq('csv BNF payee', bofa[0].payee_guess, 'ACME STUDIOS LLC REF 998');
ok('csv checkcard payee has SPOTIFY', /SPOTIFY/i.test(bofa[1].payee_guess));
ok('csv zelle payee has JANE', /JANE/i.test(bofa[2].payee_guess));
eq('csv deposit credit', bofa[3].direction, 'credit');

console.log('parseCsv — PayPal-style (Name + Gross/Fee/Net)');
const pp = R.parseCsv([
  'Date,Name,Gross,Fee,Net,Description',
  '03/10/2026,Widget Vendor,-100.00,-3.20,-103.20,Payment',
  '03/11/2026,Client A,250.00,-7.25,242.75,Invoice',
].join('\n'), 'paypal');
eq('pp count', pp.length, 2);
eq('pp match on gross', pp[0].amount, 100);
eq('pp fee captured', pp[0].fee, 3.2);
eq('pp name payee', pp[0].payee_guess, 'Widget Vendor');
eq('pp credit', pp[1].direction, 'credit');

console.log('isInternal');
ok('currency conversion', R.isInternal('Currency Conversion to USD', ''));
ok('withdrawal to bank', R.isInternal('Withdrawal to your bank', ''));
ok('online transfer', R.isInternal('Online Banking transfer to savings', ''));
ok('real vendor NOT internal', !R.isInternal('Payment to Acme Studios', 'Acme Studios'));

console.log('nameEvidence + vendorsMatch');
const pm = { [R.normalizeName('ACME STUDIOS LLC')]: 'acme studios' };
eq('learned map → 1.0', R.nameEvidence('ACME STUDIOS LLC', 'Acme Studios', pm, {}).score, 1.0);
eq('learned method', R.nameEvidence('ACME STUDIOS LLC', 'Acme Studios', pm, {}).method, 'auto-learned');
ok('alias → strong', R.nameEvidence('ACME', 'Acme Studios', {}, { acme: 'acme studios' }).score >= 0.9);
ok('exact normalized', R.vendorsMatch('Acme Studios, LLC', 'ACME STUDIOS').score >= 0.9);
ok('substring', R.vendorsMatch('Acme', 'Acme Studios Group').score >= 0.8);
ok('unrelated low', R.vendorsMatch('Acme Studios', 'Zebra Records').score < 0.6);

console.log('normalizeInvoiceNum (canonical)');
['123', 'INV-123', 'INV123', 'inv 123', '#123', 'Invoice #123', 'No. 123', '00123', '#00123', 'INV-#123']
  .forEach(v => eq(`norm ${v}`, normalizeInvoiceNum(v), '123'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

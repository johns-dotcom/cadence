// The four bank-evidence states — ONE definition, shared by Creator Payments,
// Artist Budgets and (later) Ledger/Payments rows. Mirrors the server's
// bankEvidence semantics: a row's evidence resolves at its family root.
//
//   verified            a ready statement shows the payment — provable.
//   awaiting_statement  paid, and no ready statement covers the date yet.
//                       Counted; normal, not a problem.
//   unverified          paid, a statement DOES cover the date, and no line
//                       matches — the only state that is a discrepancy.
//   unpaid              nothing left the bank.

export function recoupState(row) {
  if (row.bank_evidence) return 'verified'
  if (row.payment_status !== 'Paid') return 'unpaid'
  return row.bank_expected ? 'unverified' : 'awaiting_statement'
}

export const RECOUP_COUNTED = ['verified', 'awaiting_statement']
export const recoupCounted = (row) => RECOUP_COUNTED.includes(recoupState(row))
export const bankUnverified = (row) => recoupState(row) === 'unverified'

export const STATE_LABEL = {
  verified: 'On a statement',
  awaiting_statement: 'Paid, statement not in yet',
  unverified: 'Paid — no bank line',
  unpaid: 'Unpaid',
}
export const STATE_TONE = {
  verified: 'bg-emerald-100 text-emerald-700',
  awaiting_statement: 'bg-sky-100 text-sky-700',
  unverified: 'bg-rose-100 text-rose-700',
  unpaid: 'bg-gray-100 text-gray-500',
}

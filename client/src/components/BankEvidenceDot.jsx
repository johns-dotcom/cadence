// Bank-evidence dot — context on a row you are already reading, never a
// queue. Emerald = a ready statement shows the payment; rose = paid, a
// statement covers the date, and no line matches (the only discrepancy);
// nothing = no opinion (unpaid, or the statement just isn't in yet).

export default function BankEvidenceDot({ row, className = '' }) {
  if (row.bank_evidence) {
    const ev = row.bank_evidence
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full bg-emerald-500 ${className}`}
        title={`On the ${String(ev.account || '').toUpperCase()} statement — ${String(ev.txn_date || '').slice(0, 10)}`}
      />
    )
  }
  if (row.payment_status === 'Paid' && row.bank_expected) {
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full bg-rose-500 ${className}`}
        title="Marked paid, a statement covers that date, and no bank line matches — chase this one"
      />
    )
  }
  return null
}

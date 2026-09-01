// A payee that opens its vendor page — in a NEW TAB, deliberately.
//
// These sit inside review surfaces: a spend sheet's expanded section, an open
// worklist, a drill. Each is a pass over many rows, and navigating away loses
// the scroll position, the expanded section and the filter. A side-trip to
// check one vendor must not cost the review, so it opens beside it.
//
// `stopPropagation` because these live inside rows that are themselves
// clickable — a card, a checkbox row, a row that filters something.
//
// The target is /vendors?vendor=<name>, which opens that vendor's drawer
// directly. There is no per-vendor route in cadence; the query param IS the
// deep link, and Vendors.jsx keeps it in the URL so the tab can be shared.

export default function PayeeLink({ payee, className = '', title, children }) {
  if (!payee) return <span className={className}>—</span>
  return (
    <a
      href={`/vendors?vendor=${encodeURIComponent(payee)}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={title || `Open ${payee} in a new tab — invoices, bank lines and W9. Your place here is kept.`}
      className={`${className} hover:text-brand-ink hover:underline decoration-dotted underline-offset-2`}
    >
      {children || payee}
    </a>
  )
}

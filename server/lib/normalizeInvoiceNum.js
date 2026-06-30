// Canonical invoice-number normalizer. Single source of truth so the
// vendor-submit gate, the internal /entries dup-check, the bulk-zip matcher,
// and the ledger all agree on what counts as "the same invoice number."
//
// Strips: leading prefixes (invoice|inv|no.|#) + separators, then any
// non-leading dashes/whitespace/dots, then leading zeros. Loops the prefix
// strip so combos peel cleanly ("Invoice #123" -> "#123" -> "123").
//
// All of these normalize to "123":
//   "123" | "INV-123" | "INV123" | "inv 123" | "#123" | "Invoice #123" |
//   "No. 123" | "00123" | "#00123" | "INV-#123"
//
// Returns '' for empty input.
function normalizeInvoiceNum(num) {
  if (!num) return '';
  let s = String(num).toLowerCase().trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/^(invoice|inv|no\.?|#)[\s\-.:]*/i, '');
  } while (s && s !== prev);
  return s.replace(/[-\s.]/g, '').replace(/^0+/, '');
}

module.exports = { normalizeInvoiceNum };

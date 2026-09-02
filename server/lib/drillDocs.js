/**
 * Which document a drill row can show, and WHICH ENTRY actually holds it.
 *
 * The subtle part is the second half. A split payment is one family: the
 * invoice is attached to the ROOT, and the P&L drills into the SLICES. Asking
 * `GET /ledger/entries/:id/file/invoice` for the slice you clicked 404s, and the
 * row would report "no document" for a payment that plainly has one. So the row
 * names the entry the file is really on — the slice when it carries its own
 * copy (a per-slice proof of payment is a real thing), otherwise the root.
 *
 * Order is preference order: an invoice, then what proves it was paid, then a
 * receipt, then the vendor's W-9. The button names what it will actually open
 * rather than always claiming "invoice".
 *
 * `docSelect()` builds the SQL from this same list, so adding a document type
 * is one edit and the query, the labels and the preference order cannot drift
 * apart.
 */

const DOC_TYPES = ['invoice', 'proof', 'receipt', 'w9'];
const DOC_LABELS = { invoice: 'invoice', proof: 'proof of payment', receipt: 'receipt', w9: 'W-9' };

/**
 * SELECT fragment resolving each type to its holding entry + filename.
 * Built from the constant list above — no user input reaches this string.
 * @param {string} slice  alias of the row being drilled (the split slice)
 * @param {string} root   alias of its family root
 */
function docSelect(slice = 'e', root = 'r') {
  return DOC_TYPES.map((t) => (
    `CASE WHEN ${slice}.${t}_r2_key IS NOT NULL THEN ${slice}.id WHEN ${root}.${t}_r2_key IS NOT NULL THEN ${root}.id END AS ${t}_entry_id,
   CASE WHEN ${slice}.${t}_r2_key IS NOT NULL THEN ${slice}.${t}_filename WHEN ${root}.${t}_r2_key IS NOT NULL THEN ${root}.${t}_filename END AS ${t}_filename`
  )).join(',\n            ');
}

/** The row's documents, in preference order. `[]` means there is nothing to open. */
function docsOf(row) {
  const out = [];
  if (!row) return out;
  for (const t of DOC_TYPES) {
    const id = row[`${t}_entry_id`];
    if (id) out.push({ type: t, entry_id: id, filename: row[`${t}_filename`] || null, label: DOC_LABELS[t] });
  }
  return out;
}

module.exports = { DOC_TYPES, DOC_LABELS, docSelect, docsOf };

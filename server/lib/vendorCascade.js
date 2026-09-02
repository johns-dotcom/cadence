// Vendor-name cascade — the vendor equivalent of lib/artistCascade.js.
//
// `expenses.payee` is not the only place a vendor is referenced by STRING.
// Renaming or merging a vendor rewrote the ledger and the vendor record and
// left three other name-keyed references pointing at a name that no longer
// exists:
//
//   vendor_aliases.canonical        an alias of the folded vendor still claims
//                                   to resolve to the dead name, so the next
//                                   submission under that spelling files under
//                                   a vendor the directory cannot show.
//   statement_payee_map.ledger_payee the LEARNED bank lesson ("this descriptor
//                                   means Acme") keeps teaching the old name,
//                                   so every future statement re-creates the
//                                   vendor that was just merged away.
//   bank_transactions.vendor_override a PERSON's decision about a descriptor.
//
// Unlike the artist cascade this one RECORDS what it touched: vendor merges
// are reversible by id (vendor_merge_log), and a cascade that cannot be
// reversed makes the unmerge a lie about what it restored.
//
// Deliberately NOT cascaded:
//   vendor_payment_details.vendor_name — the vault is keyed on the vendor's
//     EMAIL by design (see the schema comment); vendor_name there is a display
//     copy of who submitted, not a reference.
//   expenses.payee / expenses.vendor_name / vendors.name / vendor_emails.vendor
//     — the merge route owns those and already logs their ids individually.

const VENDOR_NAME_KEYED = [
  ['vendor_aliases', 'canonical'],
  ['statement_payee_map', 'ledger_payee'],
  ['bank_transactions', 'vendor_override'],
];

/**
 * Repoint every name-keyed vendor reference from `from` to `into`.
 * @returns {{ids: Object<string, number[]>, deleted: {vendor_aliases: Object[]}}}
 *          — feed straight back to revertVendorCascade to undo it.
 */
async function cascadeVendorName(db, labelId, from, into) {
  const ids = {};
  const deleted = { vendor_aliases: [] };
  if (!from || !into) return { ids, deleted };

  // "into is an alias of from" is a statement that stops being sayable the
  // moment from folds into into. Repointing it would make into an alias of
  // itself, which resolves every future lookup to nothing — delete it, and
  // keep the row so an unmerge can put it back.
  const selfies = await db.query(
    `DELETE FROM vendor_aliases
      WHERE label_id = $1 AND LOWER(TRIM(canonical)) = LOWER(TRIM($2)) AND LOWER(TRIM(alias)) = LOWER(TRIM($3))
      RETURNING canonical, alias, created_by`,
    [labelId, from, into]
  );
  deleted.vendor_aliases = selfies.rows;

  for (const [table, col] of VENDOR_NAME_KEYED) {
    const r = await db.query(
      `UPDATE ${table} SET ${col} = $1
        WHERE label_id = $2 AND LOWER(TRIM(${col})) = LOWER(TRIM($3))
        RETURNING id`,
      [into, labelId, from]
    );
    if (r.rows.length) ids[table] = r.rows.map((x) => x.id);
  }
  return { ids, deleted };
}

/** Put every cascaded reference back under `from`, by id. */
async function revertVendorCascade(db, labelId, from, cascade) {
  const ids = (cascade && cascade.ids) || {};
  for (const [table, col] of VENDOR_NAME_KEYED) {
    const list = (ids[table] || []).map(Number).filter(Number.isFinite);
    if (!list.length) continue;
    await db.query(
      `UPDATE ${table} SET ${col} = $1 WHERE label_id = $2 AND id = ANY($3::int[])`,
      [from, labelId, list]
    );
  }
  for (const row of (cascade && cascade.deleted && cascade.deleted.vendor_aliases) || []) {
    await db.query(
      `INSERT INTO vendor_aliases (label_id, canonical, alias, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (label_id, LOWER(alias)) DO NOTHING`,
      [labelId, row.canonical, row.alias, row.created_by || null]
    );
  }
}

module.exports = { VENDOR_NAME_KEYED, cascadeVendorName, revertVendorCascade };

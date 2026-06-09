// Vendor upsert. Vendors are keyed by name within a label (case-insensitive).
// Spend/history is still derived from the expenses ledger; this table exists to
// hold the things that shouldn't be re-entered per invoice — contact details
// and a W9 on file. Pass a pg client (for use inside a transaction) or the
// pool. Only non-empty fields overwrite existing values.
async function upsertVendor(db, labelId, data) {
  const name = (data.name || '').trim();
  if (!name) return null;

  const { rows } = await db.query(
    'SELECT id FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
    [labelId, name]
  );

  if (rows.length) {
    const id = rows[0].id;
    await db.query(
      `UPDATE vendors SET
         email        = COALESCE(NULLIF($1,''), email),
         address      = COALESCE(NULLIF($2,''), address),
         bank         = COALESCE(NULLIF($3,''), bank),
         w9_r2_key    = COALESCE($4, w9_r2_key),
         w9_filename  = COALESCE($5, w9_filename),
         updated_at   = NOW()
       WHERE id = $6`,
      [data.email || '', data.address || '', data.bank || '', data.w9_r2_key || null, data.w9_filename || null, id]
    );
    return id;
  }

  const ins = await db.query(
    `INSERT INTO vendors (label_id, name, email, address, bank, w9_r2_key, w9_filename, created_at, updated_at)
     VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),$6,$7,NOW(),NOW())
     RETURNING id`,
    [labelId, name, data.email || '', data.address || '', data.bank || '', data.w9_r2_key || null, data.w9_filename || null]
  );
  return ins.rows[0].id;
}

module.exports = { upsertVendor };

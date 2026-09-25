// Resolve a client-supplied funding source id to a validated in-tenant id, or
// null (the label's own account — nothing owed). ONE definition, so the ledger
// pay flows and creator payments trust the picker's choice the same way. Takes
// a pool/client so it composes inside a transaction.
async function resolveFundingSource(db, labelId, raw) {
  if (raw == null || raw === '') return { ok: true, id: null };
  const sid = parseInt(raw, 10);
  if (!Number.isFinite(sid)) return { ok: false };
  const fs = await db.query('SELECT id FROM funding_sources WHERE id = $1 AND label_id = $2', [sid, labelId]);
  return fs.rows.length ? { ok: true, id: sid } : { ok: false };
}

module.exports = { resolveFundingSource };

/**
 * Optional statements inside a transaction.
 *
 * THE BUG THIS EXISTS FOR. `await client.query(sql).catch(() => {})` reads like
 * "best effort, carry on". Inside a transaction it is the opposite: Postgres
 * marks the transaction ABORTED on the first error, every later statement comes
 * back 25P02 "current transaction is aborted, commands ignored", and COMMIT
 * silently becomes a rollback. The route then returns success having written
 * NOTHING — the worst available outcome, because the operator believes the merge
 * happened and the duplicates are still there.
 *
 * Demonstrated rather than assumed: INSERT 1 → swallowed failing statement →
 * INSERT 2 → COMMIT leaves **zero** rows, not two.
 *
 * A SAVEPOINT is the fix Postgres provides. The optional statement runs inside
 * one; if it fails we roll back to the savepoint, which clears the aborted state
 * and leaves everything before it intact and committable.
 *
 * Use this ONLY where failure genuinely is acceptable (a table that may not exist
 * yet on an older database, an index that may be missing). Anything whose failure
 * should abort the write must stay a bare `client.query` so the catch above it
 * rolls the whole thing back.
 */

let counter = 0;

async function optionalStatement(client, sql, params = []) {
  // Savepoint names are identifiers, not parameters — generated here, never
  // taken from a caller.
  const name = `opt_${++counter}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    const res = await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, res };
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: false, error: err.message, code: err.code };
  }
}

module.exports = { optionalStatement };

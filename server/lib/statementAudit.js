// Pure statement-audit functions, ported from boom-dashboard's
// lib/reparse-diff.js + lib/statement-extras.js. No database, no I/O — the
// route composes these against real rows.
//
// Two rules, both learned in production (boom, 2026-08-06: a re-parse DOUBLED
// a live statement because the comparison keyed on `description`):
//
// 1. IDENTITY IS date + amount + direction + currency, NOTHING ELSE.
//    `description` and `reference` are parser OUTPUT, not properties of the
//    transaction — the deterministic parser and the AI describe the same wire
//    differently.
// 2. COMPARE COUNTS, NOT SETS. A statement legitimately holds many identical
//    rows (95 rows across 15 same-day same-amount fee groups on one real
//    statement). Each parsed row consumes one existing row; only the surplus
//    is missing.

function isoDay(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d || '').slice(0, 10);
}

// The columns keyOf reads. Any SELECT feeding rows into keyOf/diffReparseRows/
// findExtras must include ALL of these — omitting one doesn't error, it
// silently changes identity (leaving `currency` out once made every non-USD
// row read as USD: a permanent 206-row phantom mismatch).
const KEY_COLUMNS = ['txn_date', 'amount', 'direction', 'currency'];

const keyOf = (r) => [
  isoDay(r.txn_date),
  Number(r.amount).toFixed(2),
  r.direction,
  String(r.currency || 'USD').toUpperCase(),
].join('|');

const tally = (rows) => rows.reduce((m, r) => m.set(keyOf(r), (m.get(keyOf(r)) || 0) + 1), new Map());

/**
 * @returns {{missing: Array, onlyInDb: Array}}
 *   missing  — parsed rows with no counterpart left in the database; insert these
 *   onlyInDb — stored rows the parse didn't account for; REPORT, never delete
 */
function diffReparseRows(existing, parsedRows) {
  const unconsumed = tally(existing);
  const missing = [];
  for (const r of parsedRows) {
    const k = keyOf(r);
    const left = unconsumed.get(k) || 0;
    if (left > 0) unconsumed.set(k, left - 1);
    else missing.push(r);
  }

  const unmatchedByDb = tally(parsedRows);
  const onlyInDb = existing.filter((r) => {
    const k = keyOf(r);
    const left = unmatchedByDb.get(k) || 0;
    if (left > 0) { unmatchedByDb.set(k, left - 1); return false; }
    return true;
  });

  return { missing, onlyInDb };
}

/**
 * The payment's OWN identifier, read off the descriptor. A wire TRN and a
 * transfer Confirmation# are PRINTED ON THE STATEMENT and reproduced
 * identically by both parsers — so a reference can REFINE a comparison within
 * a date+amount+direction group; it must never replace the group key.
 * "CO ID:" / "ID:" are deliberately NOT read: they identify the ORIGINATOR.
 */
function refFromDescription(desc) {
  const s = String(desc || '');
  const m = s.match(/TRN:\s*([A-Z0-9]{8,})/i)
    || s.match(/Confirmation#\s*([A-Za-z0-9]{6,})/i)
    || s.match(/Conf#\s*([A-Za-z0-9]{6,})/i);
  return m ? m[1] : null;
}

/**
 * Rows that hold the WRONG PAYMENT'S DETAILS. Invisible to the count-based
 * diff by construction: one payment stored twice next to a different payment
 * of the same day and amount stored not at all is a surplus and a shortfall
 * that cancel exactly — the month reconciles to the cent while the money is
 * filed against a company that was never paid it.
 *
 * Detection is deliberately narrow, because the repair rewrites live rows:
 *   • only inside one date+amount+direction+currency group
 *   • only when a surplus row's reference DUPLICATES another row's in the group
 *   • only when exactly one statement line in the group is unaccounted for
 * Anything ambiguous is returned as `unclear` and left alone.
 */
function findMisfiled(existing, parsedRows) {
  const groups = new Map();
  const put = (r, side) => {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, { db: [], pdf: [] });
    groups.get(k)[side].push(r);
  };
  for (const r of existing) put(r, 'db');
  for (const r of parsedRows) put(r, 'pdf');

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const count = (arr, fn) => arr.reduce((m, r) => {
    const v = fn(r); if (!v) return m;
    return m.set(v, (m.get(v) || 0) + 1);
  }, new Map());

  const repairs = [];
  const unclear = [];
  for (const [k, g] of groups) {
    if (!g.db.length || !g.pdf.length) continue;

    // THE SAME EXTRACTOR ON BOTH SIDES — the stored `reference` COLUMN is
    // whatever the ingesting parse chose to put there; comparing it against
    // text-extracted references produced false findings. Read both sides out
    // of the description or not at all.
    const dbRefs = count(g.db, (r) => refFromDescription(r.description));
    const pdfRefs = count(g.pdf, (r) => refFromDescription(r.description));

    const surplus = [];
    for (const [ref, n] of dbRefs) {
      const over = n - (pdfRefs.get(ref) || 0);
      if (over <= 0) continue;
      // The LATER rows are the copies.
      const holders = g.db.filter((r) => refFromDescription(r.description) === ref).sort((a, b) => a.id - b.id);
      surplus.push(...holders.slice(holders.length - over).map((r) => ({ row: r, ref })));
    }
    if (!surplus.length) continue;

    // Which statement lines does nothing in the app represent?
    const dbDescs = count(g.db, (r) => norm(r.description));
    const orphans = [];
    const seen = new Map();
    for (const p of g.pdf) {
      const ref = refFromDescription(p.description);
      if (ref) {
        const used = seen.get(ref) || 0;
        if (used < (dbRefs.get(ref) || 0)) { seen.set(ref, used + 1); continue; }
        seen.set(ref, used + 1);
      } else {
        const d = norm(p.description);
        const used = seen.get(d) || 0;
        if (used < (dbDescs.get(d) || 0)) { seen.set(d, used + 1); continue; }
        seen.set(d, used + 1);
      }
      orphans.push(p);
    }

    // Pair only when there is no choice to make.
    if (surplus.length === 1 && orphans.length === 1) {
      repairs.push({ row: surplus[0].row, should_be: orphans[0], group: k, duplicate_of_reference: surplus[0].ref });
    } else {
      for (const s of surplus) {
        unclear.push({
          row: s.row, group: k, reference: s.ref,
          reason: orphans.length === 0
            ? 'the statement prints this reference fewer times than the app holds it, but every line in this group is already represented'
            : `${surplus.length} row(s) hold a duplicated reference and ${orphans.length} statement line(s) are unrepresented, so the pairing is a guess`,
        });
      }
    }
  }
  return { repairs, unclear };
}

// ── Extras (from boom's lib/statement-extras.js) ─────────────────────────────
// Rows the app holds that the statement itself does not support. Only possible
// because a RECONCILED deterministic parse is ground truth. Two rules:
// 1. NO GROUND TRUTH, NO OPINION — an unreconciled parse reports nothing.
// 2. REMOVE THE LEAST MEANINGFUL COPIES — rows carrying no match/booking/
//    dismissal go first, newest before oldest; survivors keep the work.

function stateWeight(r) {
  let w = 0;
  if (r.dismissed) w += 1;
  if (r.flagged) w += 1;
  if (r.matched_expense_id || r.matched_income_id) w += 4;
  return w;
}

function byRemovalPreference(a, b) {
  const d = stateWeight(a) - stateWeight(b);
  if (d) return d;                             // least state first
  const at = String(a.created_at || '');
  const bt = String(b.created_at || '');
  if (at !== bt) return bt.localeCompare(at);  // newest first
  return (b.id || 0) - (a.id || 0);
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Compare what a statement proves against what the app holds.
 * @param {Array} statementRows rows from a RECONCILED parse (ground truth)
 * @param {Array} dbRows rows currently stored for the statement
 */
function findExtras(statementRows, dbRows) {
  const expected = new Map();
  statementRows.forEach((r) => expected.set(keyOf(r), (expected.get(keyOf(r)) || 0) + 1));

  const held = new Map();
  dbRows.forEach((r) => {
    const k = keyOf(r);
    if (!held.has(k)) held.set(k, []);
    held.get(k).push(r);
  });

  const groups = [];
  let missingCount = 0;
  for (const [k, rows] of held) {
    const want = expected.get(k) || 0;
    if (rows.length <= want) continue;
    const extra = rows.length - want;
    const [date, amount, direction] = k.split('|');
    const ordered = [...rows].sort(byRemovalPreference);
    groups.push({
      key: k,
      txn_date: date,
      amount: Number(amount),
      direction,
      expected: want,
      held: rows.length,
      extra,
      remove: ordered.slice(0, extra),
      keep: ordered.slice(extra),
    });
  }

  for (const [k, want] of expected) {
    const have = (held.get(k) || []).length;
    if (have < want) missingCount += want - have;
  }

  groups.sort((a, b) => b.extra - a.extra || String(a.txn_date).localeCompare(String(b.txn_date)));
  const removals = groups.flatMap((g) => g.remove);
  return {
    groups,
    extraCount: removals.length,
    extraValue: round2(removals.reduce((s, r) => s + Math.abs(Number(r.amount)), 0)),
    missingCount,
  };
}

module.exports = {
  keyOf, isoDay, KEY_COLUMNS, diffReparseRows, refFromDescription, findMisfiled,
  findExtras, stateWeight, byRemovalPreference,
};

/**
 * Data Quality (`/api/flags`) — every check that says "something here is wrong,
 * or something here is missing", in one payload.
 *
 * Two rules the whole file is built around:
 *
 *  1. A CHECK IS TWO DIFFERENT CLAIMS. Something WRONG (duplicated,
 *     contradictory, flagged by a person) needs a decision; something MISSING
 *     is bulk data entry. Every category therefore carries `nature`
 *     ('problem' | 'completeness') and `group` (Money → Ledger → Catalog →
 *     Artists) so the page can say "N need a decision · M fields incomplete"
 *     instead of one number that made a mostly-complete catalog read as a
 *     disaster. The client renders whatever categories arrive — a new check
 *     added here shows up there without a client change.
 *
 *  2. A PLACEHOLDER IS NOT A NAME. Every artist detector assumes the text in
 *     the artist field is somebody's name and acts on that assumption, so
 *     `namesAnArtist` (lib/artistKey.js) runs FIRST. Without it "n/a" is
 *     offered as a 2-edit typo of a real artist, read as two artists to split
 *     a row between, and elected as the canonical spelling of "NA"/"N/A".
 *     "unknown" is deliberately a REAL artist name (see lib/artistKey.js) —
 *     do not add it to the placeholder set.
 *
 * Access is layered, not all-or-nothing: the page itself is permission-gated
 * client-side, catalog/artist sections serve every role, money- and
 * ledger-shaped sections need Approver+, bank rows need Admin+, and every
 * mutation (merge / rename / normalize / archive) is Admin-only. A blanket
 * admin lockout took the whole data-quality inbox away from Approvers.
 *
 * Dismissals are ONE store — `data_quality_dismissals`, keyed by a stable
 * `flag_key`. Group keys are sorted-id signatures so the same group hashes the
 * same way on every rescan and a dismissal sticks.
 */

const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { normalizeInvoiceNum } = require('../lib/normalizeInvoiceNum');
const { artistKeyOf, namesAnArtist } = require('../lib/artistKey');
const { excludeBankRows } = require('../lib/ledgerSource');

const router = express.Router();
// Reads are role-split INSIDE the handler (see ROLE GATING below); mutations
// carry requireAdmin on the route. Never put requireAdmin on the router.
router.use(authMiddleware, withTenant);

// ── Keys and normalization ──────────────────────────────────────────────────
// `artistKeyOf` is the canonical strip-everything key (lib/artistKey.js) and
// stays that. `foldKey` layers Unicode decomposition on top so "Beyoncé" and
// "Beyonce" — and roster names carrying non-breaking spaces or trailing
// periods — hash together for FUZZY MATCHING only. It is never persisted, so
// it cannot drift from artist_meta.artist_key.
const foldKey = (s) => artistKeyOf(String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''));
// Display-ish key: lower + collapsed whitespace. Used where the raw spelling
// still matters (normalization patterns keyed on the typed string).
const normKey = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

// Values people type INSTEAD of a real identifier. A row whose UPC reads "n/a"
// is missing a UPC; treating it as present would report the gap as closed.
const SENTINEL_VALUES = "('n/a', 'na', 'none', 'tbd', '-', '—', 'unknown', 'missing', 'pending', '?', '0', '00')";
const blankOrSentinel = (col) => `(${col} IS NULL OR TRIM(${col}) = '' OR LOWER(TRIM(${col})) IN ${SENTINEL_VALUES})`;

// Iterative Levenshtein (two-row). Called O(n²) over roster/payee lists, so it
// allocates one row rather than a full matrix.
function levDist(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  const v = new Array(n + 1);
  for (let j = 0; j <= n; j++) v[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = v[0]; v[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = v[j];
      v[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, v[j], v[j - 1]);
      prev = tmp;
    }
  }
  return v[n];
}
// Longer strings tolerate more noise. Same scale for artists and vendors.
const fuzzyThreshold = (longer) => (longer <= 6 ? 1 : longer <= 12 ? 2 : 3);

// Tiny union-find, used four times (releases/artists/vendors/blank invoices).
function unionFind() {
  const parent = new Map();
  const ensure = (x) => { if (!parent.has(x)) parent.set(x, x); };
  const find = (x) => { ensure(x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const groups = () => {
    const out = new Map();
    for (const k of parent.keys()) { const r = find(k); if (!out.has(r)) out.set(r, []); out.get(r).push(k); }
    return out;
  };
  return { ensure, find, union, groups, has: (x) => parent.has(x) };
}

// ── Vocabulary ──────────────────────────────────────────────────────────────
// Categories where an empty artist is a gap rather than the right answer.
// (Salary / Rent / Bank Fees genuinely belong to no artist.) 'Radio' isn't in
// the seeded vocabulary but a workspace may have added it — membership tests
// on free text cost nothing.
const ARTIST_REQUIRED_CATEGORIES = new Set([
  'Marketing', 'PR', 'Radio', 'Recording', 'Music Video',
  'Production', 'Sync/Licensing', 'Mixing & Mastering', 'Distribution', 'Design',
]);
// Narrow separator set for the "this is really two artists" flag. ' x ' and
// 'feat' are deliberately absent — splitting on them would create child rows
// for featured artists nobody wants in the ledger.
const MULTI_NAME_SPLIT = /,|&|\/| and /i;
// Broad set for the normalization surface, where a collab string is being
// mapped to ONE base artist rather than split. Whitespace-anchored so
// "Alexander" and "6ix9ine" don't match on 'x'.
const MULTI_ARTIST_SPLIT = /,|\s+&\s+|\s+\/\s+|\s+and\s+|\s+with\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+x\s+|\s+×\s+/i;
const MULTI_ARTIST_SQL = "(,|\\s+&\\s+|\\s+/\\s+|\\s+and\\s+|\\s+with\\s+|\\s+feat\\.?\\s+|\\s+ft\\.?\\s+|\\s+x\\s+|×)";

const MONEY = 'Money', LEDGER = 'Ledger', CATALOG = 'Catalog', ARTISTS = 'Artists';

// ── Dismissals ──────────────────────────────────────────────────────────────
// One store, keyed by flag_key. Per-row artist flags renamed when this file
// adopted boom's kind vocabulary; LEGACY_KIND keeps the dismissals people
// already made suppressing the same rows.
const LEGACY_KIND = {
  artist_unknown: 'unknown_artist',
  artist_variants: 'casing',
  artist_multi_name: 'multi_name',
  artist_missing: 'missing_artist',
  ledger_missing_song: 'missing_song',
  ledger_missing_socials: 'missing_socials',
};
const rowFlagKey = (kind, id) => `artflag:${kind}:${id}`;

async function loadDismissals(labelId) {
  const { rows } = await pool.query(
    `SELECT flag_key, kind, note, summary, dismissed_by, dismissed_at
       FROM data_quality_dismissals WHERE label_id = $1 ORDER BY dismissed_at DESC`,
    [labelId]
  );
  const byKey = new Map(rows.map(r => [r.flag_key, r]));
  return {
    rows,
    hit: (key) => byKey.get(key) || null,
    rowHit: (kind, id) => byKey.get(rowFlagKey(kind, id))
      || (LEGACY_KIND[kind] ? byKey.get(rowFlagKey(LEGACY_KIND[kind], id)) : null)
      || null,
  };
}

// ── Duplicate releases ──────────────────────────────────────────────────────
// Keyed on ARTIST + name, never name alone: "Intro" and "Deluxe" are shared
// titles, and keying on the title alone pairs two artists' unrelated records.
async function getDuplicateReleases(L) {
  const { rows } = await pool.query(
    `SELECT r.id, r.project_name, r.artist_id, r.release_date, r.upc, r.isrc,
            r.spotify_uri, r.cover_art_url, r.release_type, a.name AS artist_name
       FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
      WHERE r.label_id = $1 AND (r.archived = false OR r.archived IS NULL)`,
    [L]
  );
  const sentinel = new Set(['n/a', 'na', 'none', 'tbd', '-', '—', 'unknown', 'missing', 'pending', '?', '0', '00']);
  const clean = (v) => { const s = String(v || '').trim().toLowerCase(); return s && !sentinel.has(s) ? s : null; };
  const buckets = [
    ['Same artist & project name', (r) => (r.project_name && String(r.project_name).trim() ? `${r.artist_id || 0}|${normKey(r.project_name)}` : null)],
    ['Same UPC', (r) => clean(r.upc)],
    ['Same ISRC', (r) => clean(r.isrc)],
    ['Same Spotify URI', (r) => clean(r.spotify_uri)],
  ];
  const raw = [];
  for (const [reason, keyOf] of buckets) {
    const m = new Map();
    for (const r of rows) { const k = keyOf(r); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    for (const items of m.values()) if (items.length > 1) raw.push({ reason, releases: items });
  }
  // One card per id-set, carrying every reason it matched on.
  const merged = new Map();
  for (const g of raw) {
    const sig = g.releases.map(r => r.id).sort((a, b) => a - b).join(',');
    if (merged.has(sig)) { const ex = merged.get(sig); if (!ex.reasons.includes(g.reason)) ex.reasons.push(g.reason); }
    else merged.set(sig, { reasons: [g.reason], releases: g.releases, group_key: sig });
  }
  return [...merged.values()].sort((a, b) => b.releases.length - a.releases.length);
}

// ── Duplicate artists ───────────────────────────────────────────────────────
async function getDuplicateArtists(L) {
  const { rows } = await pool.query(
    `SELECT a.id, a.name,
            (SELECT COUNT(*)::int FROM releases r WHERE r.artist_id = a.id AND r.label_id = $1) AS total_releases,
            (SELECT COUNT(*)::int FROM contracts c WHERE c.artist_id = a.id AND c.label_id = $1) AS contract_count
       FROM artists a WHERE a.label_id = $1 ORDER BY a.name ASC`,
    [L]
  );
  const normed = rows.map(r => ({ ...r, _n: foldKey(r.name) })).filter(r => r._n.length >= 3);
  if (normed.length < 2) return [];
  const uf = unionFind();
  normed.forEach(r => uf.ensure(r.id));
  for (let i = 0; i < normed.length; i++) for (let j = i + 1; j < normed.length; j++) {
    const a = normed[i], b = normed[j];
    if (Math.abs(a._n.length - b._n.length) > 3) continue;
    if (a._n === b._n) { uf.union(a.id, b.id); continue; }
    if (levDist(a._n, b._n) <= fuzzyThreshold(Math.max(a._n.length, b._n.length))) uf.union(a.id, b.id);
  }
  const byId = new Map(normed.map(r => [r.id, r]));
  const out = [];
  for (const ids of uf.groups().values()) {
    if (ids.length < 2) continue;
    const artists = ids.map(id => byId.get(id))
      .map(r => ({ id: r.id, name: r.name, total_releases: r.total_releases || 0, contract_count: r.contract_count || 0 }))
      // Most-invested record first — that's the one to keep.
      .sort((a, b) => (b.total_releases + b.contract_count) - (a.total_releases + a.contract_count));
    out.push({ artists, group_key: ids.slice().sort((a, b) => a - b).join(',') });
  }
  return out.sort((a, b) => b.artists.length - a.artists.length);
}

// ── Duplicate vendors ───────────────────────────────────────────────────────
// Ledger payees that look like one vendor under two spellings. Pairs already
// linked through vendor_aliases are excluded — an admin resolved those on
// purpose, and re-offering them is how a merge gets undone by accident.
async function getDuplicateVendors(L) {
  const { rows } = await pool.query(
    `SELECT TRIM(payee) AS payee,
            COUNT(*)::int     AS invoice_count,
            MAX(invoice_date) AS last_invoice,
            MIN(invoice_date) AS first_invoice,
            BOOL_OR(w9_r2_key IS NOT NULL) AS has_w9,
            SUM(COALESCE(amount, 0))::numeric AS total_amount
       FROM expenses
      WHERE label_id = $1 AND (deleted = false OR deleted IS NULL)
        AND payee IS NOT NULL AND TRIM(payee) <> ''
      GROUP BY TRIM(payee)`,
    [L]
  );
  if (rows.length < 2) return [];
  const { rows: aliasRows } = await pool.query(
    'SELECT LOWER(TRIM(canonical)) AS p, LOWER(TRIM(alias)) AS a FROM vendor_aliases WHERE label_id = $1', [L]
  ).catch(() => ({ rows: [] }));
  const aliased = new Set(aliasRows.map(r => [r.p, r.a].sort().join('||')));

  const normed = rows.map(r => ({ ...r, _n: foldKey(r.payee) })).filter(r => r._n.length >= 3);
  if (normed.length < 2) return [];
  const uf = unionFind();
  normed.forEach(r => uf.ensure(r.payee));
  for (let i = 0; i < normed.length; i++) for (let j = i + 1; j < normed.length; j++) {
    const a = normed[i], b = normed[j];
    if (Math.abs(a._n.length - b._n.length) > 3) continue;
    if (aliased.has([a.payee.toLowerCase(), b.payee.toLowerCase()].sort().join('||'))) continue;
    if (a._n === b._n) { uf.union(a.payee, b.payee); continue; }
    if (levDist(a._n, b._n) <= fuzzyThreshold(Math.max(a._n.length, b._n.length))) uf.union(a.payee, b.payee);
  }
  const byPayee = new Map(normed.map(r => [r.payee, r]));
  const out = [];
  for (const names of uf.groups().values()) {
    if (names.length < 2) continue;
    const vendors = names.map(p => byPayee.get(p)).map(r => ({
      payee: r.payee, invoice_count: r.invoice_count || 0, last_invoice: r.last_invoice,
      first_invoice: r.first_invoice, has_w9: !!r.has_w9, total_amount: Number(r.total_amount) || 0,
    })).sort((a, b) => {
      // Canonical-looking first: most invoices, then W9 on file, then longest history.
      if (b.invoice_count !== a.invoice_count) return b.invoice_count - a.invoice_count;
      if (a.has_w9 !== b.has_w9) return a.has_w9 ? -1 : 1;
      const af = a.first_invoice ? new Date(a.first_invoice).getTime() : Infinity;
      const bf = b.first_invoice ? new Date(b.first_invoice).getTime() : Infinity;
      return af - bf;
    });
    out.push({ vendors, group_key: vendors.map(v => v.payee.toLowerCase()).sort().join('|') });
  }
  return out.sort((a, b) =>
    b.vendors.reduce((s, x) => s + x.invoice_count, 0) - a.vendors.reduce((s, x) => s + x.invoice_count, 0));
}

// ── W9 name vs payee ────────────────────────────────────────────────────────
// The real W9 name lives inside `expenses.w9_scan` (lib/aiScan.js writes
// `w9_name` there); `vendors` has no such column and nothing ever wrote one.
// So this check reads the scan JSON — the only place the fact exists — rather
// than a column that would always be NULL.
async function getW9NameMismatches(L) {
  const { rows } = await pool.query(
    `SELECT e.id, e.payee, e.w9_scan->>'w9_name' AS w9_name, e.w9_filename
       FROM expenses e
      WHERE e.label_id = $1 AND (e.deleted = false OR e.deleted IS NULL)
        AND e.w9_scan IS NOT NULL AND COALESCE(e.w9_scan->>'w9_name', '') <> ''
        AND e.payee IS NOT NULL AND TRIM(e.payee) <> ''`,
    [L]
  );
  const seen = new Map();
  for (const r of rows) {
    if (!foldKey(r.w9_name) || foldKey(r.w9_name) === foldKey(r.payee)) continue;
    const key = normKey(r.payee);
    // One card per payee — the same vendor's W9 is scanned on many invoices.
    if (!seen.has(key)) seen.set(key, { payee: r.payee, w9_name: r.w9_name, entry_id: r.id, w9_filename: r.w9_filename, group_key: `vw9:${key}` });
  }
  return [...seen.values()];
}

// ── Duplicate invoices ──────────────────────────────────────────────────────
// Four tiers. Rows born FROM a bank debit are excluded up front: they carry no
// invoice number by construction (a statement line was turned into a ledger
// row, there was never a vendor invoice), so they land in the blank-number
// tier en masse — a bank charging five identical transfer fees in one day is
// normal, not a duplicate. The bank side has its own duplicate checks.
async function getDuplicateInvoices(L) {
  const { rows: entries } = await pool.query(
    `SELECT e.id, e.invoice_date, e.payee, e.vendor_name, e.invoice_number, e.amount, e.currency,
            e.payment_status, e.status, e.artist, e.song, e.category, e.entry_source,
            e.invoice_filename, (e.invoice_r2_key IS NOT NULL) AS has_invoice,
            e.receipt_filename, (e.receipt_r2_key IS NOT NULL) AS has_receipt
       FROM expenses e
      WHERE e.label_id = $1
        AND (e.deleted = false OR e.deleted IS NULL)
        AND (e.voided  = false OR e.voided  IS NULL)
        AND e.status <> 'rejected'
        AND e.parent_id IS NULL
        AND e.payee IS NOT NULL AND TRIM(e.payee) <> ''
        AND ${excludeBankRows('e')}`,
    [L]
  );
  if (entries.length < 2) return [];

  // Alias-resolved vendor key: payees explicitly linked in vendor_aliases
  // collapse to one bucket, so "Eddie Marange" and "Edward Marange" group.
  const { rows: aliasRows } = await pool.query(
    'SELECT LOWER(TRIM(canonical)) AS p, LOWER(TRIM(alias)) AS a FROM vendor_aliases WHERE label_id = $1', [L]
  ).catch(() => ({ rows: [] }));
  const uf = unionFind();
  for (const r of aliasRows) if (r.p && r.a) uf.union(r.p, r.a);
  const vendorKey = (name) => { const k = String(name || '').toLowerCase().trim(); return k ? uf.find(k) : ''; };

  const enriched = entries.map(e => {
    const amt = Number(e.amount);
    const d = e.invoice_date ? new Date(e.invoice_date) : null;
    return {
      ...e,
      _vk: vendorKey(e.payee || e.vendor_name),
      _inv: normalizeInvoiceNum(e.invoice_number),
      // Integer cents — a stored 100.10 must bucket with another 100.10.
      _cents: Number.isFinite(amt) ? Math.round(amt * 100) : null,
      _cur: String(e.currency || 'USD').toUpperCase(),
      _date: d && !isNaN(d.getTime()) ? d : null,
    };
  });

  const rawGroups = [];
  // Tier 1 / 2a — same vendor + normalized invoice #. Amounts agreeing means
  // "booked twice"; amounts disagreeing means one of them is wrong. Both need
  // eyes, so the whole bucket surfaces either way.
  const byVendorInv = new Map();
  for (const e of enriched) {
    if (!e._vk || !e._inv) continue;
    const k = `${e._vk}|${e._inv}`;
    if (!byVendorInv.has(k)) byVendorInv.set(k, []);
    byVendorInv.get(k).push(e);
  }
  for (const bucket of byVendorInv.values()) {
    if (bucket.length < 2) continue;
    const agree = new Set(bucket.map(e => `${e._cents}|${e._cur}`)).size === 1;
    rawGroups.push({
      reason: agree ? 'Same vendor + invoice # + amount' : 'Same vendor + invoice # (amount mismatch)',
      severity: 'high', entries: bucket,
    });
  }

  // Tier 2b — BOTH sides blank-numbered: same vendor + amount + currency,
  // invoice dates within ±7 days. Union-find inside each partition so a chain
  // of three entries six days apart collapses to one group, not two pairs.
  const buf = unionFind();
  const byBlank = new Map();
  for (const e of enriched) {
    if (e._inv) continue;
    if (!e._vk || !e._cents || !e._date) continue;
    buf.ensure(e.id);
    const k = `${e._vk}|${e._cents}|${e._cur}`;
    if (!byBlank.has(k)) byBlank.set(k, []);
    byBlank.get(k).push(e);
  }
  for (const list of byBlank.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a._date - b._date);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if ((list[j]._date - list[i]._date) / 86400000 > 7) break; // sorted — the rest are further
      buf.union(list[i].id, list[j].id);
    }
  }
  const byId = new Map(enriched.map(e => [e.id, e]));
  for (const ids of buf.groups().values()) {
    if (ids.length < 2) continue;
    rawGroups.push({ reason: 'Same vendor + amount + date (no invoice #)', severity: 'medium', entries: ids.map(i => byId.get(i)) });
  }

  // Tier 3 — same normalized number under DIFFERENT vendors, same amount and
  // currency, number length ≥ 4. Both guards are load-bearing: without the
  // amount requirement and the length floor, "1"/"2"/"3" collide across every
  // vendor in the workspace and drown the section.
  const byInv = new Map();
  for (const e of enriched) {
    if (!e._inv || e._inv.length < 4 || !e._cents || !e._vk) continue;
    const k = `${e._inv}|${e._cents}|${e._cur}`;
    if (!byInv.has(k)) byInv.set(k, []);
    byInv.get(k).push(e);
  }
  for (const list of byInv.values()) {
    if (list.length < 2) continue;
    if (new Set(list.map(e => e._vk)).size < 2) continue; // already Tier 1/2a
    rawGroups.push({ reason: 'Same invoice # under different vendors', severity: 'low', entries: list });
  }

  const order = { low: 1, medium: 2, high: 3 };
  const merged = new Map();
  for (const g of rawGroups) {
    const sig = g.entries.map(e => e.id).sort((a, b) => a - b).join(',');
    if (merged.has(sig)) {
      const ex = merged.get(sig);
      if (!ex.reasons.includes(g.reason)) ex.reasons.push(g.reason);
      if ((order[g.severity] || 0) > (order[ex.severity] || 0)) ex.severity = g.severity;
    } else merged.set(sig, { reasons: [g.reason], severity: g.severity, entries: g.entries });
  }
  const toUi = (e) => ({
    id: e.id, invoice_date: e.invoice_date, payee: e.payee, vendor_name: e.vendor_name,
    invoice_number: e.invoice_number, amount: e.amount, currency: e.currency,
    payment_status: e.payment_status, status: e.status, entry_source: e.entry_source,
    artist: e.artist, song: e.song, category: e.category,
    invoice_filename: e.invoice_filename, has_invoice: !!e.has_invoice,
    receipt_filename: e.receipt_filename, has_receipt: !!e.has_receipt,
  });
  return [...merged.values()].map(g => ({
    reasons: g.reasons, severity: g.severity,
    // Earliest first — the original is the one most likely to be right.
    entries: g.entries.slice().sort((a, b) =>
      (a.invoice_date ? new Date(a.invoice_date).getTime() : 0) - (b.invoice_date ? new Date(b.invoice_date).getTime() : 0)).map(toUi),
    group_key: g.entries.map(e => e.id).sort((a, b) => a - b).join(','),
  })).sort((a, b) => ((order[b.severity] || 0) - (order[a.severity] || 0)) || (b.entries.length - a.entries.length));
}

// ── Completeness ────────────────────────────────────────────────────────────
// Denominators AND uncapped counts. The item lists LIMIT 500; reporting a
// capped count would say a 900-row gap is 500 rows, which reads as more
// complete than it is — the opposite of the point. One round trip.
async function getCompletenessTotals(L) {
  const activeRel = `(r.archived = false OR r.archived IS NULL)`;
  const out = `r.release_date IS NOT NULL AND r.release_date <= CURRENT_DATE`;
  const withReleases = `EXISTS (SELECT 1 FROM releases r WHERE r.artist_id = a.id AND r.label_id = a.label_id)`;
  const { rows: [t] } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM releases r WHERE r.label_id = $1 AND ${activeRel})                                   AS releases_active,
      (SELECT COUNT(*) FROM releases r WHERE r.label_id = $1 AND ${activeRel} AND ${out})                        AS releases_out,
      (SELECT COUNT(*) FROM artists a WHERE a.label_id = $1 AND ${withReleases})                                 AS artists_with_releases,
      (SELECT COUNT(*) FROM releases r WHERE r.label_id = $1 AND ${activeRel} AND ${blankOrSentinel('r.genre')}) AS miss_rel_genre,
      (SELECT COUNT(*) FROM releases r WHERE r.label_id = $1 AND ${activeRel} AND ${out} AND ${blankOrSentinel('r.upc')})         AS miss_rel_upc,
      (SELECT COUNT(*) FROM releases r WHERE r.label_id = $1 AND ${activeRel} AND ${out} AND ${blankOrSentinel('r.isrc')})        AS miss_rel_isrc,
      (SELECT COUNT(*) FROM releases r WHERE r.label_id = $1 AND ${activeRel} AND ${out} AND ${blankOrSentinel('r.spotify_uri')}) AS miss_rel_spotify,
      (SELECT COUNT(*) FROM artists a WHERE a.label_id = $1 AND ${withReleases} AND ${blankOrSentinel('a.genre')})       AS miss_art_genre,
      (SELECT COUNT(*) FROM artists a WHERE a.label_id = $1 AND ${withReleases} AND ${blankOrSentinel('a.spotify_url')}) AS miss_art_spotify
  `, [L]).catch(() => ({ rows: [{}] }));
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    releases_missing_genre:   { of_total: n(t.releases_active), missing_total: n(t.miss_rel_genre) },
    releases_missing_upc:     { of_total: n(t.releases_out), missing_total: n(t.miss_rel_upc) },
    releases_missing_isrc:    { of_total: n(t.releases_out), missing_total: n(t.miss_rel_isrc) },
    releases_missing_spotify: { of_total: n(t.releases_out), missing_total: n(t.miss_rel_spotify) },
    artists_missing_genre:    { of_total: n(t.artists_with_releases), missing_total: n(t.miss_art_genre) },
    artists_missing_spotify:  { of_total: n(t.artists_with_releases), missing_total: n(t.miss_art_spotify) },
  };
}

const RELEASE_LIST_SELECT = `r.id, r.project_name, r.release_date, r.release_type, r.artist_id, a.name AS artist_name`;
async function releasesMissing(L, col, label, releasedOnly) {
  const { rows } = await pool.query(
    `SELECT ${RELEASE_LIST_SELECT}
       FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
      WHERE r.label_id = $1 AND (r.archived = false OR r.archived IS NULL)
        ${releasedOnly ? 'AND r.release_date IS NOT NULL AND r.release_date <= CURRENT_DATE' : ''}
        AND ${blankOrSentinel(`r.${col}`)}
      ORDER BY r.release_date DESC NULLS LAST, r.id DESC LIMIT 500`,
    [L]
  );
  return rows.map(r => ({ ...r, missing: label }));
}
async function artistsMissing(L, col, label) {
  const { rows } = await pool.query(
    `SELECT a.id, a.name,
            (SELECT COUNT(*)::int FROM releases r WHERE r.artist_id = a.id AND r.label_id = a.label_id) AS total_releases
       FROM artists a
      WHERE a.label_id = $1
        AND EXISTS (SELECT 1 FROM releases r WHERE r.artist_id = a.id AND r.label_id = a.label_id)
        AND ${blankOrSentinel(`a.${col}`)}
      ORDER BY total_releases DESC, a.name ASC LIMIT 500`,
    [L]
  );
  return rows.map(r => ({ ...r, missing: label }));
}

// ── Ledger artist-column detectors ──────────────────────────────────────────
// One pass over APPROVED rows. status='pending' (vendor-submitted, not yet
// reviewed) and 'rejected' are deliberately excluded: vendors routinely type
// junk into the artist field and admins fix it during approval, so surfacing
// those here would double the Approvals queue and read as ledger noise.
const LEDGER_ROW_SELECT = `
  e.id, e.invoice_date, e.payee, e.artist, e.song, e.category, e.amount, e.currency,
  e.release_id, e.parent_id, e.entry_source, e.cobrand, e.social_handles,
  COALESCE(e.parent_id, e.id) AS file_entry_id, e.artist_breakdown,
  (SELECT COUNT(*)::int FROM expenses c WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)) AS split_count,
  -- family_amount, not amount: SplitModal validates a RE-split against the whole
  -- family total (the parent holds only its own slice once children exist).
  (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c
     WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)), 0)) AS family_amount,
  e.invoice_filename, (e.invoice_r2_key IS NOT NULL) AS has_invoice,
  e.receipt_filename, (e.receipt_r2_key IS NOT NULL) AS has_receipt`;

async function getArtistFlags(L, dism) {
  const { rows: entries } = await pool.query(
    `SELECT ${LEDGER_ROW_SELECT} FROM expenses e
      WHERE e.label_id = $1 AND e.status = 'approved'
        AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)`,
    [L]
  );
  const { rows: artists } = await pool.query('SELECT id, name FROM artists WHERE label_id = $1', [L]);
  const rosterByNorm = new Map();
  for (const a of artists) { const k = foldKey(a.name); if (k && !rosterByNorm.has(k)) rosterByNorm.set(k, a); }
  const { rows: releaseRows } = await pool.query(
    `SELECT r.id AS release_id, r.project_name, a.id AS artist_id, a.name AS artist_name
       FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
      WHERE r.label_id = $1`, [L]
  );
  const releaseById = new Map(releaseRows.map(r => [r.release_id, r]));
  // Known collab strings already mapped to a base artist are answered, not flagged.
  const { rows: mapRows } = await pool.query('SELECT pattern FROM artist_normalization_map WHERE label_id = $1', [L]);
  const mapped = new Set(mapRows.map(m => normKey(m.pattern)));

  const out = { unknown: [], likely_typo: [], variants: [], multi_name: [], missing: [], placeholder: [], song_mismatch: [] };
  const push = (bucket, kind, e, suggestion, extra) => {
    if (dism.rowHit(kind, e.id)) return;
    out[bucket].push({ ...e, flag_key: rowFlagKey(kind, e.id), suggestion: suggestion ?? null, ...extra });
  };

  for (const e of entries) {
    const trimmed = String(e.artist || '').trim();
    const key = foldKey(trimmed);
    const inRoster = !!(key && rosterByNorm.has(key));

    // A placeholder is decided FIRST — see the header note. Every detector
    // below assumes the field holds a name.
    if (trimmed && !namesAnArtist(trimmed) && !e.parent_id) { push('placeholder', 'artist_placeholder', e); continue; }

    if (!trimmed) {
      if (ARTIST_REQUIRED_CATEGORIES.has(e.category) && !e.parent_id) push('missing', 'artist_missing', e);
      continue; // no text — no text detector can run
    }
    if (mapped.has(normKey(trimmed))) continue; // normalization rule already answers this string

    if (MULTI_NAME_SPLIT.test(trimmed) && !e.split_count) {
      push('multi_name', 'artist_multi_name', e, trimmed.split(MULTI_NAME_SPLIT).map(p => p.trim()).filter(Boolean));
      continue; // multi-name supersedes unknown/typo
    }
    if (e.release_id) {
      const rel = releaseById.get(e.release_id);
      if (rel?.artist_name && foldKey(rel.artist_name) !== key) {
        push('song_mismatch', 'artist_song_mismatch', e,
          { artist_id: rel.artist_id, artist_name: rel.artist_name, project_name: rel.project_name });
        continue;
      }
    }
    if (!inRoster) {
      let best = null;
      for (const [rk, a] of rosterByNorm) {
        if (Math.abs(rk.length - key.length) > 2) continue;
        const d = levDist(key, rk);
        if (d > 0 && d <= 2 && (!best || d < best.dist)) { best = { dist: d, artist: a }; if (d === 1) break; }
      }
      if (best) push('likely_typo', 'artist_likely_typo', e, { artist_id: best.artist.id, artist_name: best.artist.name });
      else push('unknown', 'artist_unknown', e);
    }
  }

  // Spelling / casing variants — 2+ raw spellings that fold to one key. Its own
  // pass, so it needs its own placeholder guard: without it "n/a", "N/A" and
  // "NA" become a three-spelling "artist" with a canonical form.
  const variantsByKey = new Map();
  for (const e of entries) {
    const raw = String(e.artist || '').trim();
    if (!raw || !namesAnArtist(raw)) continue;
    const k = foldKey(raw);
    if (!k) continue;
    if (!variantsByKey.has(k)) variantsByKey.set(k, new Map());
    const m = variantsByKey.get(k);
    m.set(raw, (m.get(raw) || 0) + 1);
  }
  for (const [k, counts] of variantsByKey) {
    if (counts.size < 2) continue;
    const spellings = [...counts.keys()];
    // Canonical = the roster's EXACT spelling, else the most-used. Matching on
    // the folded key here would be circular — every spelling in this group
    // folds to the roster's key, so "zeke bleu" would be elected as the
    // canonical form of "Zeke Bleu".
    const canonical = spellings.find(s => rosterByNorm.get(foldKey(s))?.name === s)
      || [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const s of spellings) {
      if (s === canonical) continue;
      const rep = entries.find(e => String(e.artist || '').trim() === s);
      if (!rep) continue;
      if (dism.rowHit('artist_variants', rep.id)) continue;
      out.variants.push({
        ...rep, flag_key: rowFlagKey('artist_variants', rep.id),
        suggestion: { artist_name: canonical }, occurrence_count: counts.get(s), _fold: k,
      });
    }
  }
  return out;
}

// Project-bound rows with no song. A split PARENT with an empty song is fine
// when a child carries one — the parent is just the family container — and
// reimbursements are excluded (they name what was bought, not a song).
async function getMissingSongFlags(L, dism) {
  const cats = [...ARTIST_REQUIRED_CATEGORIES];
  const { rows } = await pool.query(
    `SELECT ${LEDGER_ROW_SELECT}, e.invoice_number FROM expenses e
      WHERE e.label_id = $1 AND e.status = 'approved'
        AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
        AND (e.song IS NULL OR TRIM(e.song) = '')
        AND e.category = ANY($2::text[])
        AND (e.is_reimbursement = false OR e.is_reimbursement IS NULL)
        AND NOT EXISTS (SELECT 1 FROM expenses c WHERE c.parent_id = e.id
                          AND (c.deleted = false OR c.deleted IS NULL)
                          AND c.song IS NOT NULL AND TRIM(c.song) <> '')
      ORDER BY e.invoice_date DESC NULLS LAST, e.id DESC`,
    [L, cats]
  );
  return rows.filter(r => !dism.rowHit('ledger_missing_song', r.id))
    .map(r => ({ ...r, flag_key: rowFlagKey('ledger_missing_song', r.id), suggestion: null }));
}

// Rows that should plausibly carry social handles. Marketing / PR are where
// creator payments live, and `cobrand = TRUE` extends it to co-branded spend
// in any category — that is exactly the row a handle belongs on.
async function getMissingSocialsFlags(L, dism) {
  const { rows } = await pool.query(
    `SELECT ${LEDGER_ROW_SELECT} FROM expenses e
      WHERE e.label_id = $1 AND e.status = 'approved'
        AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
        AND (e.is_reimbursement = false OR e.is_reimbursement IS NULL)
        AND e.parent_id IS NULL
        AND (e.social_handles IS NULL
             OR jsonb_typeof(e.social_handles) <> 'array'
             OR jsonb_array_length(e.social_handles) = 0)
        AND (e.category IN ('Marketing', 'PR') OR e.cobrand = TRUE)
      ORDER BY e.invoice_date DESC NULLS LAST, e.id DESC`,
    [L]
  );
  return rows.filter(r => !dism.rowHit('ledger_missing_socials', r.id))
    .map(r => ({ ...r, flag_key: rowFlagKey('ledger_missing_socials', r.id), suggestion: null }));
}

// ── Multi-artist normalization groups ───────────────────────────────────────
// Auto-detected: one group per distinct collab string, with how many rows and
// how much money ride on it, plus the parsed candidates for the base picker.
async function getMultiArtistGroups(L) {
  const { rows } = await pool.query(
    `SELECT LOWER(TRIM(e.artist)) AS source_key, MAX(e.artist) AS source_display,
            COUNT(*)::int AS row_count, SUM(COALESCE(e.amount, 0))::numeric AS total_amount
       FROM expenses e
      WHERE e.label_id = $1
        AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
        AND COALESCE(e.status, 'approved') = 'approved'
        AND e.parent_id IS NULL
        AND e.artist IS NOT NULL AND TRIM(e.artist) <> ''
        AND e.artist ~* '${MULTI_ARTIST_SQL}'
      GROUP BY LOWER(TRIM(e.artist))
      ORDER BY COUNT(*) DESC, SUM(COALESCE(e.amount, 0)) DESC`,
    [L]
  ).catch(err => { console.error('multi-artist groups:', err.message); return { rows: [] }; });
  // A string that already has a rule is answered — drop it from the worklist.
  const { rows: mapRows } = await pool.query('SELECT pattern FROM artist_normalization_map WHERE label_id = $1', [L]);
  const mapped = new Set(mapRows.map(m => normKey(m.pattern)));
  return rows.filter(r => !mapped.has(normKey(r.source_display || r.source_key))).map(r => ({
    group_key: r.source_key, source_key: r.source_key, source_display: r.source_display || '',
    row_count: r.row_count, total_amount: Number(r.total_amount) || 0,
    candidates: String(r.source_display || '').split(MULTI_ARTIST_SPLIT).map(s => s.trim()).filter(Boolean),
  }));
}

// ── Human-raised flags ──────────────────────────────────────────────────────
// Somebody hits the flag button on a ledger row or marks F in a review deck,
// and until now the only way to find it again was to scroll back to the row.
async function getFlaggedExpenses(L) {
  const { rows } = await pool.query(
    `SELECT ${LEDGER_ROW_SELECT}, e.invoice_number, e.payment_status, e.flag_reason, e.flagged_at, e.flagged_by
       FROM expenses e
      WHERE e.label_id = $1 AND e.flagged = true
        AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
      ORDER BY e.flagged_at DESC NULLS LAST, e.id DESC LIMIT 300`,
    [L]
  );
  return rows;
}
async function getFlaggedTransactions(L) {
  const { rows } = await pool.query(
    `SELECT t.id, t.txn_date, t.amount, COALESCE(t.currency, 'USD') AS currency, t.description,
            t.payee_guess, t.direction, t.statement_id, s.account, s.filename,
            (t.matched_expense_id IS NOT NULL OR t.matched_income_id IS NOT NULL) AS is_booked
       FROM bank_transactions t
       JOIN bank_statements s ON s.id = t.statement_id AND s.label_id = t.label_id AND s.status = 'ready'
      WHERE t.label_id = $1 AND t.flagged = true AND (t.dismissed = false OR t.dismissed IS NULL)
      ORDER BY t.txn_date DESC NULLS LAST, t.id DESC LIMIT 300`,
    [L]
  ).catch(() => ({ rows: [] }));
  return rows;
}

// ── GET /api/flags ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const L = req.labelId;
    const includeDismissed = req.query.include_dismissed === '1';
    // ROLE GATING. Catalog + artist checks are metadata hygiene and serve every
    // role that has the page. Ledger and vendor/invoice checks are money-shaped
    // (Approver+, matching the bookkeeping gate). Bank rows are Admin+, matching
    // the Statements pages — an Approver does full ledger review but
    // deliberately does not see bank data.
    const role = req.user?.role;
    const isBkRole = role === 'Superadmin' || role === 'Admin' || role === 'Approver';
    const isBankRole = role === 'Superadmin' || role === 'Admin';

    const dism = await loadDismissals(L);
    const [dupReleases, dupArtists, relGenre, relUpc, relIsrc, relSpotify, artGenre, artSpotify] = await Promise.all([
      getDuplicateReleases(L), getDuplicateArtists(L),
      releasesMissing(L, 'genre', 'Genre', false),
      releasesMissing(L, 'upc', 'UPC', true),
      releasesMissing(L, 'isrc', 'ISRC', true),
      releasesMissing(L, 'spotify_uri', 'Spotify link', true),
      artistsMissing(L, 'genre', 'Genre'),
      artistsMissing(L, 'spotify_url', 'Spotify link'),
    ]);
    const money = isBkRole
      ? await Promise.all([
        getDuplicateVendors(L), getDuplicateInvoices(L), getW9NameMismatches(L),
        getArtistFlags(L, dism), getMissingSongFlags(L, dism), getMissingSocialsFlags(L, dism),
        getMultiArtistGroups(L), getFlaggedExpenses(L),
      ])
      : [[], [], [], { unknown: [], likely_typo: [], variants: [], multi_name: [], missing: [], placeholder: [], song_mismatch: [] }, [], [], [], []];
    const [dupVendors, dupInvoices, w9Mismatch, af, missSong, missSocials, multiArtist, flaggedExpenses] = money;
    const flaggedTxns = isBankRole ? await getFlaggedTransactions(L) : [];

    // Group dismissals: tag, then either filter out or annotate for the
    // show-dismissed view. Same treatment for every group-shaped category.
    const partition = (prefix, groups) => {
      const tagged = groups.map(g => {
        const flag_key = g.group_key.startsWith(`${prefix}:`) ? g.group_key : `${prefix}:${g.group_key}`;
        const hit = dism.hit(flag_key);
        return { ...g, flag_key, dismissed: !!hit, ...(hit ? { dismissed_by: hit.dismissed_by, dismissed_at: hit.dismissed_at } : {}) };
      });
      return includeDismissed ? tagged : tagged.filter(g => !g.dismissed);
    };
    const relGroups = partition('reldupe', dupReleases);
    const artGroups = partition('artdupe', dupArtists);
    const venGroups = partition('vendupe', dupVendors);
    const invGroups = partition('invdupe', dupInvoices);
    const w9Groups = partition('vw9', w9Mismatch);

    const cat = (kind, label, description, severity, group, nature, payload) => ({
      kind, label, description, severity, group, nature, ...payload,
      count: (payload.items || payload.groups || []).length,
    });

    const categories = [];
    if (isBkRole) categories.push(
      cat('duplicate_invoices', 'Potential Duplicate Invoices',
        'Ledger rows that look like the same invoice was booked twice. Compares vendor (aliases resolved), normalized invoice number, amount, currency and date. Rows born from a bank debit are excluded — they never had an invoice number.',
        'high', MONEY, 'problem', { groups: invGroups }),
      cat('duplicate_vendors', 'Potential Duplicate Vendors',
        'Payee names that look like one vendor under two spellings — identical after normalization, or a Levenshtein edit away. Pairs already linked through vendor aliases are excluded.',
        'high', MONEY, 'problem', { groups: venGroups }),
      cat('vendor_w9_mismatch', 'W9 Name ≠ Payee',
        'The name the AI read off the W9 does not match the payee the ledger uses. Either the payee is a trading name, or the wrong W9 is on file.',
        'medium', MONEY, 'problem', { groups: w9Groups }),
      cat('flagged_expenses', 'Ledger — Flagged for Review',
        'Ledger rows someone flagged by hand, with whatever reason they left. Clearing a flag is the same toggle on the row itself.',
        'medium', MONEY, 'problem', { items: flaggedExpenses }),
    );
    if (isBankRole) categories.push(
      cat('flagged_transactions', 'Statements — Flagged in Review',
        'Bank transactions marked during a review-deck run. Flagging is a marker, not a decision — these are still open and come back around in the next run.',
        'medium', MONEY, 'problem', { items: flaggedTxns }),
    );
    if (isBkRole) categories.push(
      cat('artist_likely_typo', 'Ledger — Likely Artist Typo',
        'The artist on the row is a 1–2 character edit from a roster name. Accept the suggestion to fix it in place.',
        'high', LEDGER, 'problem', { items: af.likely_typo }),
      cat('artist_song_mismatch', 'Ledger — Artist ↔ Song Mismatch',
        'The row is linked to a release whose artist is not the artist on the row.',
        'high', LEDGER, 'problem', { items: af.song_mismatch }),
      cat('artist_unknown', 'Ledger — Unknown Artist',
        'The artist on the row matches no name on the roster, and is not close enough to be a typo.',
        'medium', LEDGER, 'problem', { items: af.unknown }),
      cat('artist_multi_name', 'Ledger — Multiple Artists in One Field',
        'One artist field holding several artists. Usually this row wants to be a split.',
        'medium', LEDGER, 'problem', { items: af.multi_name }),
      cat('artist_placeholder', 'Ledger — Placeholder Artist',
        'The artist field holds a placeholder ("n/a", "TBD") rather than a name. Reports count these as unattributed while the ledger prints them as an artist. Name the artist, or clear the field.',
        'medium', LEDGER, 'problem', { items: af.placeholder }),
      cat('artist_multi_normalize', 'Ledger — Multi-Artist Rows',
        'Rows whose artist field lists a collab. Pick one base artist per string — existing rows are renamed and the mapping is remembered so future entries collapse on their own.',
        'medium', LEDGER, 'problem', { groups: multiArtist }),
      cat('artist_variants', 'Ledger — Spelling / Casing Variants',
        'The ledger uses several spellings of one artist ("zeke bleu" and "Zeke Bleu"). Canonicalize so reports group correctly.',
        'low', LEDGER, 'problem', { items: af.variants }),
      cat('artist_missing', 'Ledger — Missing Artist',
        'An artist-required category (Marketing, PR, Recording, …) with an empty artist field.',
        'medium', LEDGER, 'completeness', { items: af.missing }),
      cat('ledger_missing_song', 'Ledger — Missing Song',
        'Project-bound rows with no song attached. Split parents are skipped when a child carries the song; reimbursements are excluded.',
        'medium', LEDGER, 'completeness', { items: missSong }),
      cat('ledger_missing_socials', 'Ledger — Missing Socials',
        'Marketing / PR / cobrand rows with no social handles on file. Not every invoice in these categories needs them — dismiss the ones that are not creator-related.',
        'low', LEDGER, 'completeness', { items: missSocials }),
    );
    categories.push(
      cat('duplicate_releases', 'Potential Duplicate Releases',
        'Releases sharing an artist + title, a UPC, an ISRC, or a Spotify URI.',
        'high', CATALOG, 'problem', { groups: relGroups }),
      cat('releases_missing_genre', 'Releases Missing Genre', 'Active releases with no genre on file.',
        'medium', CATALOG, 'completeness', { items: relGenre }),
      cat('releases_missing_upc', 'Released — Missing UPC', 'Releases past their release date without a UPC.',
        'medium', CATALOG, 'completeness', { items: relUpc }),
      cat('releases_missing_isrc', 'Released — Missing ISRC', 'Releases past their release date without an ISRC.',
        'low', CATALOG, 'completeness', { items: relIsrc }),
      cat('releases_missing_spotify', 'Released — Missing Spotify Link',
        'Releases past their release date with no Spotify URI — either it never went live, or the link was never recorded.',
        'medium', CATALOG, 'completeness', { items: relSpotify }),
      cat('duplicate_artists', 'Potential Duplicate Artists',
        'Artist records whose names are identical or near-identical after normalization.',
        'high', ARTISTS, 'problem', { groups: artGroups }),
      cat('artists_missing_genre', 'Artists Missing Genre', 'Artists with releases on file but no genre.',
        'medium', ARTISTS, 'completeness', { items: artGenre }),
      cat('artists_missing_spotify', 'Artists Missing Spotify Link', 'Artists with releases on file but no Spotify link recorded.',
        'medium', ARTISTS, 'completeness', { items: artSpotify }),
    );

    // Honest denominators + UNCAPPED counts for the completeness bars.
    const totals = await getCompletenessTotals(L).catch(() => ({}));
    for (const c of categories) {
      const t = totals[c.kind];
      if (!t) continue;
      if (t.of_total != null) c.of_total = t.of_total;
      if (t.missing_total != null) c.count = t.missing_total;
    }

    // Roster + saved rules ride along: the normalization section needs both
    // (typeahead + the rules already in force) and neither is worth a second
    // round trip from a page that already fetched everything else.
    const roster = (await pool.query('SELECT id, name FROM artists WHERE label_id = $1 ORDER BY name', [L])).rows;
    const normalizationMap = isBkRole
      ? (await pool.query('SELECT id, pattern, base_artist, created_by, created_at FROM artist_normalization_map WHERE label_id = $1 ORDER BY pattern', [L])).rows
      : [];

    res.json({ success: true, data: { categories, dismissed: dism.rows, roster, normalization_map: normalizationMap } });
  } catch (error) {
    console.error('Flags error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Dismissals ──────────────────────────────────────────────────────────────
// `summary` is the human sentence the Dismissed view prints. Without it the
// list showed the raw key ("reldupe:12-15") as its primary copy, which is a
// machine identifier standing in for the thing that was waved off.
router.post('/dismiss', async (req, res) => {
  try {
    const flag_key = String(req.body.flag_key || '').trim();
    if (!flag_key) return res.status(400).json({ success: false, error: 'flag_key required' });
    await pool.query(
      `INSERT INTO data_quality_dismissals (label_id, flag_key, kind, note, summary, dismissed_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (label_id, flag_key) DO UPDATE SET
         kind = EXCLUDED.kind, note = EXCLUDED.note, summary = EXCLUDED.summary,
         dismissed_by = EXCLUDED.dismissed_by, dismissed_at = NOW()`,
      [req.labelId, flag_key, req.body.kind || null, req.body.note || null,
        req.body.summary ? String(req.body.summary).slice(0, 300) : null, req.user.name]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Dismiss error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
router.post('/restore', async (req, res) => {
  try {
    await pool.query('DELETE FROM data_quality_dismissals WHERE label_id = $1 AND flag_key = $2',
      [req.labelId, String(req.body.flag_key || '')]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Normalization map (collab string → base artist) ─────────────────────────
// Apply = store the rule + rename existing rows so the collab collapses
// everywhere. `artist_income` is NOT in the cascade: cadence keys it by
// artist_id, so there is no name string on it to rewrite.
router.post('/normalization', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const pattern = String(req.body.pattern || '').trim();
    const base = String(req.body.base_artist || req.body.base || '').trim();
    // No client.release() on this path — the finally below releases, and
    // releasing twice throws OUTSIDE the try (pg-pool double-release) and
    // takes the process down.
    if (!pattern || !base) return res.status(400).json({ success: false, error: 'Pattern and base artist required' });
    if (normKey(pattern) === normKey(base)) return res.status(400).json({ success: false, error: 'Base must differ from the pattern' });
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO artist_normalization_map (label_id, pattern, base_artist, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (label_id, LOWER(pattern)) DO UPDATE SET base_artist = EXCLUDED.base_artist, created_by = EXCLUDED.created_by`,
      [req.labelId, pattern, base, req.user.name]
    );
    const ex = await client.query('UPDATE expenses SET artist = $1 WHERE LOWER(TRIM(artist)) = LOWER(TRIM($2)) AND label_id = $3', [base, pattern, req.labelId]);
    const dl = await client.query('UPDATE deals SET artist_name = $1 WHERE LOWER(TRIM(artist_name)) = LOWER(TRIM($2)) AND label_id = $3', [base, pattern, req.labelId]);
    await client.query('COMMIT');
    await logActivity(req, 'Applied artist normalization', `${pattern} → ${base}`);
    res.json({ success: true, data: { expenses: ex.rowCount, deals: dl.rowCount, renamed: ex.rowCount } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Normalization error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});
router.delete('/normalization/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Bad id' });
    await pool.query('DELETE FROM artist_normalization_map WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Merges ──────────────────────────────────────────────────────────────────
// All three accept EITHER a single source or a `source_ids` / `source_names`
// array, and fold the whole group inside ONE transaction. The array form is
// what the page uses: a group of four used to fire three separate confirms and
// three unawaited concurrent POSTs racing each other's reloads.
const intList = (body, one, many) => {
  const raw = Array.isArray(body[many]) ? body[many] : (body[one] != null ? [body[one]] : []);
  return [...new Set(raw.map(v => parseInt(v, 10)).filter(Number.isFinite))];
};

router.post('/merge-artists', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const targetId = parseInt(req.body.target_id, 10);
    const sourceIds = intList(req.body, 'source_id', 'source_ids').filter(id => id !== targetId);
    if (!targetId || !sourceIds.length) return res.status(400).json({ success: false, error: 'Pick a survivor and at least one other artist' });
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, name FROM artists WHERE id = ANY($1::int[]) AND label_id = $2',
      [[targetId, ...sourceIds], req.labelId]);
    if (rows.length !== sourceIds.length + 1) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Artist not found in this workspace' }); }
    const target = rows.find(r => r.id === targetId);
    const sources = rows.filter(r => r.id !== targetId);
    for (const source of sources) {
      for (const t of ['releases', 'contracts', 'artist_income', 'campaigns', 'artist_dev_log']) {
        await client.query(`UPDATE ${t} SET artist_id = $1 WHERE artist_id = $2 AND label_id = $3`, [targetId, source.id, req.labelId]);
      }
      // String-keyed references. deals.artist_name is a live column the
      // normalization endpoint already rewrites — leaving it behind means the
      // pipeline still carries a deleted artist's name.
      await client.query('UPDATE expenses SET artist = $1 WHERE LOWER(TRIM(artist)) = LOWER(TRIM($2)) AND label_id = $3', [target.name, source.name, req.labelId]);
      await client.query('UPDATE deals SET artist_name = $1 WHERE LOWER(TRIM(artist_name)) = LOWER(TRIM($2)) AND label_id = $3', [target.name, source.name, req.labelId]);
      await client.query('DELETE FROM artists WHERE id = $1 AND label_id = $2', [source.id, req.labelId]);
    }
    await client.query('COMMIT');
    await logActivity(req, 'Merged artists', `${sources.map(s => s.name).join(', ')} → ${target.name}`);
    res.json({ success: true, data: { merged: sources.length } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Merge artists error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

// Rename an artist in place, cascading the string-keyed references. The
// duplicate-artists card offers this because two records are not always a
// merge — sometimes one is simply spelled wrong.
router.post('/rename-artist', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.body.id, 10);
    const name = String(req.body.name || '').trim();
    if (!Number.isFinite(id) || !name) return res.status(400).json({ success: false, error: 'id and name required' });
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, name FROM artists WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Artist not found' }); }
    const old = rows[0].name;
    // Always checked, never gated on "did the name change" — the two spellings
    // in a duplicate group frequently differ only in whitespace, which normKey
    // collapses, so a gated check skipped exactly the case that then hit
    // artists_label_id_name_key and 500'd.
    const clash = await client.query('SELECT 1 FROM artists WHERE label_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) AND id <> $3', [req.labelId, name, id]);
    if (clash.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ success: false, error: 'Another artist already has that name — merge them instead' }); }
    await client.query('UPDATE artists SET name = $1 WHERE id = $2 AND label_id = $3', [name, id, req.labelId]);
    await client.query('UPDATE expenses SET artist = $1 WHERE LOWER(TRIM(artist)) = LOWER(TRIM($2)) AND label_id = $3', [name, old, req.labelId]);
    await client.query('UPDATE deals SET artist_name = $1 WHERE LOWER(TRIM(artist_name)) = LOWER(TRIM($2)) AND label_id = $3', [name, old, req.labelId]);
    await client.query('COMMIT');
    await logActivity(req, 'Renamed artist', `${old} → ${name}`);
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Rename artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

router.post('/merge-releases', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const targetId = parseInt(req.body.target_id, 10);
    const sourceIds = intList(req.body, 'source_id', 'source_ids').filter(id => id !== targetId);
    if (!targetId || !sourceIds.length) return res.status(400).json({ success: false, error: 'Pick a survivor and at least one other release' });
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM releases WHERE id = ANY($1::int[]) AND label_id = $2',
      [[targetId, ...sourceIds], req.labelId]);
    if (rows.length !== sourceIds.length + 1) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Release not found in this workspace' }); }
    let target = rows.find(r => r.id === targetId);
    const sources = rows.filter(r => r.id !== targetId);
    const fillable = ['upc', 'isrc', 'spotify_uri', 'artist_id', 'genre', 'release_date', 'cover_art_url', 'notes', 'producer', 'featured_artists', 'release_type'];
    for (const source of sources) {
      // Survivor keeps its own values and fills only its blanks — a merge
      // must never overwrite a field somebody filled in.
      const sets = [], vals = [];
      for (const f of fillable) {
        if (target[f] === undefined) continue;
        if ((target[f] === null || target[f] === '') && source[f] != null && source[f] !== '') { vals.push(source[f]); sets.push(`${f} = $${vals.length}`); target = { ...target, [f]: source[f] }; }
      }
      if (sets.length) { vals.push(targetId, req.labelId); await client.query(`UPDATE releases SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND label_id = $${vals.length}`, vals); }
      await client.query(
        `UPDATE dsp_submissions s SET release_id = $1 WHERE s.release_id = $2 AND s.label_id = $3
           AND NOT EXISTS (SELECT 1 FROM dsp_submissions t WHERE t.release_id = $1 AND t.platform = s.platform)`,
        [targetId, source.id, req.labelId]
      );
      await client.query('DELETE FROM dsp_submissions WHERE release_id = $1 AND label_id = $2', [source.id, req.labelId]);
      await client.query('UPDATE tasks SET release_id = $1 WHERE release_id = $2 AND label_id = $3', [targetId, source.id, req.labelId]);
      await client.query('UPDATE expenses SET release_id = $1 WHERE release_id = $2 AND label_id = $3', [targetId, source.id, req.labelId]);
      await client.query('DELETE FROM releases WHERE id = $1 AND label_id = $2', [source.id, req.labelId]);
    }
    await client.query('COMMIT');
    await logActivity(req, 'Merged releases', `${sources.map(s => s.project_name).join(', ')} → ${target.project_name}`);
    res.json({ success: true, data: { merged: sources.length } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Merge releases error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

// Archive one release — the non-admin-shaped resolution when two records are
// both real but one is retired. Cheaper and reversible where a merge is not.
router.post('/archive-release', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.body.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Bad id' });
    const { rowCount } = await pool.query('UPDATE releases SET archived = TRUE WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Release not found' });
    await logActivity(req, 'Archived release', `#${id} (from Data Quality)`);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

router.post('/merge-vendors', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const target = String(req.body.target_name || '').trim();
    const raw = Array.isArray(req.body.source_names) ? req.body.source_names : (req.body.source_name != null ? [req.body.source_name] : []);
    const sources = [...new Set(raw.map(s => String(s || '').trim()).filter(s => s && s.toLowerCase() !== target.toLowerCase()))];
    if (!target || !sources.length) return res.status(400).json({ success: false, error: 'Pick a survivor and at least one other vendor name' });
    await client.query('BEGIN');
    for (const source of sources) {
      await client.query('UPDATE expenses SET payee = $1 WHERE LOWER(TRIM(payee)) = LOWER(TRIM($2)) AND label_id = $3', [target, source, req.labelId]);
      await client.query('UPDATE expenses SET vendor_name = $1 WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM($2)) AND label_id = $3', [target, source, req.labelId]);
      await client.query('DELETE FROM vendors WHERE LOWER(name) = LOWER($1) AND label_id = $2 AND EXISTS (SELECT 1 FROM vendors WHERE LOWER(name) = LOWER($3) AND label_id = $2)', [source, req.labelId, target]);
      await client.query('UPDATE vendors SET name = $1 WHERE LOWER(name) = LOWER($2) AND label_id = $3', [target, source, req.labelId]);
      // Keep the old spelling as an ALIAS. This is what makes the merge stick:
      // dup detection excludes aliased pairs, the dup-check gate resolves a
      // future submission under the old name onto the canonical vendor, and
      // bank matching reads the same table.
      await client.query(
        `INSERT INTO vendor_aliases (label_id, canonical, alias, created_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (label_id, LOWER(alias)) DO UPDATE SET canonical = EXCLUDED.canonical`,
        [req.labelId, target, source, req.user.name]
      );
      // An alias pointing at a name that just became an alias itself would
      // strand the chain — repoint anything that named this source.
      await client.query('UPDATE vendor_aliases SET canonical = $1 WHERE label_id = $2 AND LOWER(TRIM(canonical)) = LOWER(TRIM($3))', [target, req.labelId, source]);
    }
    await client.query('COMMIT');
    await logActivity(req, 'Merged vendors', `${sources.join(', ')} → ${target}`);
    res.json({ success: true, data: { merged: sources.length } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Merge vendors error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

module.exports = router;

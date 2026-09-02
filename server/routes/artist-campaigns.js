// Artist Campaigns — per-artist campaign spend, on TWO layers.
//
// ── Why two ──
// This page used to read INVOICES and call the total "actual": every visible
// row's USD, all time, with no bank dimension at all. That is the exact
// construct the reference app documents as its own worst bug — one page counting
// invoices while Spend by Artist counted what left the bank, and the same
// question answered $274,289 here and $157,831 there.
//
//   SETTLED    what the STATEMENTS show, per artist, in a date range. NOT
//              derived here: it comes from `buildPnl().by_artist` (routes/
//              reports.js), which is the cash-basis, family-dated, part-aware
//              rollup that ties to the P&L by construction.
//
//   COMMITTED  in-scope invoice money the P&L has NOT counted — the forward
//              view. Unpaid invoices of any date, plus paid ones dated outside
//              the Settled window.
//
// ── The double-count guard, and one deliberate divergence ──
// The reference app guards with `bank_evidence IS NOT NULL`, because ITS P&L is
// STATEMENT-mastered: a row is settled exactly when a bank line shows it.
// Cadence's P&L is LEDGER-mastered cash (approved + Paid, family-dated by the
// root — see the header of routes/reports.js), so a paid row with no bank line
// IS already in the Settled layer. Porting that predicate verbatim double-counts
// it — measured on the dev workspace at the first run of this endpoint: Zeke
// Bleu read $1,200 settled and $1,200 "awaiting", the same money twice.
//
// So the guard here is SET MEMBERSHIP, not a predicate: `buildPnl` is asked for
// the ids it counted (`collectCountedIds`) and Committed is everything in scope
// that is not in that set. A predicate reconstructing "approved and Paid and
// dated in range and not report-dismissed and not month-moved" would drift the
// first time either side changed; a set cannot.
//
// "Paid with no bank line" survives as a disclosure, attached to the layer it
// actually describes: it is a quality statement about SETTLED money, not a
// bucket of Committed.
//
// Committed is deliberately date-UNBOUNDED. It is a forward view, and an invoice
// dated last November that is still unpaid belongs in it. Two numbers under one
// date range would quietly mean different things; the page says which is which.
//
// Scope, exclusions and the artist key all live in lib/campaignScope.js.
// Rounding is AT THE ROW throughout (lib/usd.js), because every figure here is
// sliced more than one way — by state, by song, by category — and each slicing
// has to tie to the same total.
const express = require('express');
const ExcelJS = require('exceljs');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { toUSD } = require('../lib/fx');
const { isValidDay } = require('../lib/calendarDay');
const { usdOf, round2 } = require('../lib/usd');
const { recordMentions } = require('../lib/mentions');
const { excludeBankRows } = require('../lib/ledgerSource');
const { bankEvidenceCols, loadAccounts } = require('../lib/bankEvidence');
const S = require('../lib/campaignScope');

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

// ── helpers ──────────────────────────────────────────────────────────────
const normKey = S.artistKeyOf;         // artist_meta / song_campaign_status keys
const bucketKey = S.artistBucketKey;   // money buckets — folds placeholders to ''
const songKeyOf = S.songKeyOf;
const rowUsd = (r) => round2(usdOf(r.amount, r.currency, r.fx_rate_to_usd));
const isAdmin = (req) => ['Superadmin', 'Admin'].includes(req.user.role);
const today = () => new Date().toISOString().slice(0, 10);

// Missing socials: a row's own social_handles is empty AND it is not a split
// child (children inherit from the parent — flagging them would double-count).
const MISSING_SOCIALS = `(
  e.parent_id IS NULL AND (
    e.social_handles IS NULL OR jsonb_typeof(e.social_handles) <> 'array'
    OR jsonb_array_length(e.social_handles) = 0))`;

/**
 * Per-artist campaign money, both layers, keyed IDENTICALLY.
 *
 * The artist key is `artistBucketKey` in JS, never a SQL lower-and-strip: the
 * two disagree on placeholders ("N/A", "TBD", "various" fold to unattributed
 * here and to their own bucket there), and keying one layer each way would give
 * an artist two cards and count placeholder spend as an artist on one side and
 * as nobody's on the other.
 */
async function campaignLayers(labelId, { from, to }) {
  const { buildPnl } = require('./reports');
  const cats = await S.loadCampaignCategories(pool, labelId);
  const keys = S.catKeys(cats);
  const accounts = await loadAccounts(pool, labelId);
  const countedIds = new Set();
  const pnl = await buildPnl(labelId, from, to, null, { collectCountedIds: countedIds });

  const inScopeSum = (byCat) => round2(Object.entries(byCat || {})
    .filter(([c]) => S.inScope(c, keys))
    .reduce((t, [, v]) => t + (Number(v) || 0), 0));

  // ── Settled (bank basis, in range) ──
  const settled = new Map();
  let unattributedSettled = 0;
  const unattributedByCategory = {};
  for (const a of pnl.by_artist?.rows || []) {
    const v = inScopeSum(a.by_category);
    if (a.key === '') {
      unattributedSettled = v;
      for (const c of cats) unattributedByCategory[c] = round2(Number(a.by_category?.[c]) || 0);
      continue;
    }
    if (v) settled.set(a.key, { total: v, name: a.name });
  }

  // ── Committed (invoice side, date-UNBOUNDED) ──
  // EVERY family member, not just roots: a split payment's slices carry their
  // own artist, and crediting the root's artist with the whole thing is the
  // family/attribution bug the P&L side already fixed. Each member contributes
  // its OWN amount, so the slices re-add to the family total.
  //
  // `excludeBankRows` is applied to the family ROOT, not the member: split
  // children are inserted without `entry_source`, so a member-level test lets a
  // slice of a bank-born payment through. The bank-evidence guard below would
  // catch most of them anyway; this makes it explicit rather than incidental.
  const { rows: members } = await pool.query(
    `SELECT e.id, e.parent_id, e.artist, e.amount, e.currency, e.fx_rate_to_usd,
            e.payment_status, e.payment_date, e.invoice_date, e.payee, e.category,
            (${MISSING_SOCIALS}) AS missing_socials,
            ${bankEvidenceCols('e', accounts)}
       FROM expenses e
       JOIN expenses root ON root.id = COALESCE(e.parent_id, e.id) AND root.label_id = e.label_id
      WHERE e.label_id = $1
        AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
        AND COALESCE(e.status, 'approved') IN ('approved', 'pending')
        AND ${S.inScopeSql('e', '$2')}
        AND ${excludeBankRows('root')}
        AND NOT ${S.personExcludedSql('e', '$1')}`,
    [labelId, keys]
  );

  const committed = new Map();
  const quality = new Map();   // bank quality OF the settled layer, per artist
  const socials = new Map();
  const spellings = new Map();
  const blank = () => ({
    total: 0, count: 0, unpaid: 0, unpaid_count: 0,
    paid_outside_range: 0, paid_outside_count: 0,
  });
  const blankQ = () => ({
    with_bank_line: 0, with_count: 0,
    awaiting_statement: 0, awaiting_count: 0,
    no_bank_line: 0, no_bank_line_count: 0,
  });
  let committedUnattributed = 0;

  // Counted over EVERY member, both layers: a payment the bank has already made
  // still needs its influencer handles, and a card title needs a spelling
  // whichever layer the money is in.
  for (const m of members) {
    const key = bucketKey(m.artist);
    if (m.missing_socials) socials.set(key, (socials.get(key) || 0) + 1);
    if (key) {
      if (!spellings.has(key)) spellings.set(key, new Map());
      const rawName = String(m.artist || '').trim();
      if (rawName) spellings.get(key).set(rawName, (spellings.get(key).get(rawName) || 0) + 1);
    }
  }

  // ── the double-count guard: one partition, no row on both sides ──
  const layers = S.partitionByLayer(members, countedIds);
  const doubleCountBlocked = layers.settled.length;   // proof the guard fired

  for (const m of layers.settled) {
    const key = bucketKey(m.artist);
    const usd = rowUsd(m);
    if (!quality.has(key)) quality.set(key, blankQ());
    const q = quality.get(key);
    if (m.bank_evidence) { q.with_bank_line = round2(q.with_bank_line + usd); q.with_count += 1; }
    else if (m.bank_expected) { q.no_bank_line = round2(q.no_bank_line + usd); q.no_bank_line_count += 1; }
    else { q.awaiting_statement = round2(q.awaiting_statement + usd); q.awaiting_count += 1; }
  }

  for (const m of layers.committed) {
    const usd = rowUsd(m);
    if (!usd) continue;
    const key = bucketKey(m.artist);
    if (!committed.has(key)) committed.set(key, blank());
    const c = committed.get(key);
    c.total = round2(c.total + usd); c.count += 1;
    if (String(m.payment_status || '') === 'Paid') {
      // Paid, but the P&L did not count it here — it settled in another period.
      c.paid_outside_range = round2(c.paid_outside_range + usd); c.paid_outside_count += 1;
    } else { c.unpaid = round2(c.unpaid + usd); c.unpaid_count += 1; }
    if (!key) committedUnattributed = round2(committedUnattributed + usd);
  }

  // What this page EXCLUDES, disclosed rather than left as an unexplained gap.
  // In-scope open invoices are dropped for two reasons a person chose: dismissed
  // from the page entirely, or reclassified "not a campaign expense". Both are
  // correct and both MOVE the Committed figure, so the total says so.
  let excluded = { count: null, total: null };
  try {
    const { rows: [x] } = await pool.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(CASE WHEN e.fx_rate_to_usd > 0 THEN e.amount / e.fx_rate_to_usd
                                WHEN UPPER(COALESCE(e.currency,'USD')) = 'USD' THEN e.amount
                                ELSE 0 END), 0)::float8 AS total
         FROM expenses e
         JOIN expenses root ON root.id = COALESCE(e.parent_id, e.id) AND root.label_id = e.label_id
        WHERE e.label_id = $1
          AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
          AND COALESCE(e.status, 'approved') IN ('approved', 'pending')
          AND ${S.inScopeSql('e', '$2')}
          AND ${excludeBankRows('root')}
          AND ${S.personExcludedSql('e', '$1')}`,
      [labelId, keys]
    );
    excluded = { count: x.count, total: round2(x.total) };
  } catch (err) {
    console.error('[artist-campaigns] exclusion disclosure unavailable:', err.message);
  }

  const bestSpelling = new Map();
  for (const [key, tally] of spellings) bestSpelling.set(key, S.bestOf(tally) || key);

  // The ad POOL: spend a rule says bills the label, not a release. Disclosed on
  // its own — it is what Allocate Advertising draws from, and keeping it out of
  // the coverage denominator is what stops coverage capping below 100 forever.
  const ll = pnl.by_artist?.label_level || { total: 0, count: 0, by_category: {} };
  const labelLevel = {
    total: inScopeSum(ll.by_category),
    count: ll.count || 0,
    rule_count: ll.rule_count || 0,
    by_category: Object.fromEntries(cats.map((c) => [c, round2(Number(ll.by_category?.[c]) || 0)])),
  };

  // Recoveries netting INTO these categories. `by_artist` is gross of contra
  // income while the P&L's own line is net, so the difference is stated rather
  // than left for somebody to find.
  const recoveries = round2((pnl.contra || [])
    .filter((c) => S.inScope(c.target, keys))
    .reduce((t, c) => t + (Number(c.total) || 0), 0));

  // ATTRIBUTABLE campaign spend: what names an artist plus what still could.
  const attributableSettled = round2([...settled.values()].reduce((t, v) => t + v.total, 0));
  const campaignTotal = round2(attributableSettled + unattributedSettled);

  return {
    settled, committed, quality, socials, bestSpelling,
    unattributedSettled, unattributedByCategory, committedUnattributed,
    labelLevel, excluded, recoveries, doubleCountBlocked,
    campaign_total: campaignTotal,
    coverage_pct: campaignTotal > 0 ? round2(((campaignTotal - unattributedSettled) / campaignTotal) * 100) : null,
    scope: { categories: cats, from, to, basis: pnl.basis, ties_to_pnl: pnl.by_artist?.ties_to_pnl !== false },
    keys, cats, accounts,
  };
}

// ══ STATIC ROUTES (must precede /:artist) ══════════════════════════════════

// GET /?from&to — one card per artist, both layers.
router.get('/', async (req, res) => {
  try {
    const to = isValidDay(req.query.to) ? req.query.to : today();
    const from = isValidDay(req.query.from) ? req.query.from : `${to.slice(0, 4)}-01-01`;
    if (from > to) return res.status(400).json({ success: false, error: 'The range is backwards — from is after to' });
    const L = await campaignLayers(req.labelId, { from, to });

    const meta = (await pool.query('SELECT * FROM artist_meta WHERE label_id = $1', [req.labelId])).rows;
    const metaByKey = Object.fromEntries(meta.map((m) => [m.artist_key, m]));
    const campaigns = (await pool.query(
      'SELECT artist, planned_amount, currency, expense_id FROM influencer_campaigns WHERE label_id = $1', [req.labelId]
    )).rows;
    const songFlags = (await pool.query(
      `SELECT artist_key, COUNT(*)::int AS n FROM song_campaign_status
        WHERE label_id = $1 AND flagged = true GROUP BY artist_key`, [req.labelId]
    )).rows;
    const songFlagByKey = Object.fromEntries(songFlags.map((s) => [s.artist_key, s.n]));

    const byKey = new Map();
    const card = (key) => {
      if (!byKey.has(key)) byKey.set(key, {
        artist_key: key, display: key,
        settled: 0, committed: 0, committed_unpaid: 0, committed_paid_outside_range: 0,
        committed_count: 0, unpaid_count: 0, paid_outside_count: 0,
        settled_with_bank_line: 0, settled_awaiting_statement: 0,
        flagged_no_bank_line: { count: 0, total: 0 },
        missing_socials_count: 0,
        campaign_count: 0, planned_total: 0, unlinked_campaign_count: 0, flagged_songs: 0,
      });
      return byKey.get(key);
    };
    for (const [key, v] of L.settled) {
      if (!key) continue;                       // unattributed is its own block
      const c = card(key); c.display = v.name || c.display; c.settled = v.total;
    }
    for (const [key, v] of L.committed) {
      if (!key) continue;
      const c = card(key);
      if (c.display === key) c.display = L.bestSpelling.get(key) || key;
      c.committed = v.total;
      c.committed_count = v.count;
      c.committed_unpaid = v.unpaid;
      c.unpaid_count = v.unpaid_count;
      c.committed_paid_outside_range = v.paid_outside_range;
      c.paid_outside_count = v.paid_outside_count;
    }
    // Bank quality OF the settled layer — "N paid with no bank line" describes
    // money already counted, so it hangs off Settled and never off Committed.
    for (const [key, q] of L.quality) {
      if (!key) continue;
      const c = card(key);
      c.settled_with_bank_line = q.with_bank_line;
      c.settled_awaiting_statement = q.awaiting_statement;
      c.flagged_no_bank_line = { count: q.no_bank_line_count, total: q.no_bank_line };
    }
    for (const [key, n] of L.socials) { if (key) card(key).missing_socials_count = n; }
    for (const c of campaigns) {
      const k = bucketKey(c.artist);
      if (!k || !byKey.has(k)) continue;        // no card = no campaign spend either way
      const a = byKey.get(k);
      a.campaign_count += 1;
      a.planned_total = round2(a.planned_total + await toUSD(c.planned_amount, c.currency));
      if (!c.expense_id) a.unlinked_campaign_count += 1;
    }
    for (const [k, n] of Object.entries(songFlagByKey)) { if (byKey.has(k)) byKey.get(k).flagged_songs = n; }

    const data = [...byKey.values()].map((c) => {
      const m = metaByKey[c.artist_key] || {};
      return {
        ...c,
        // Compatibility aliases for any reader not yet re-pointed at the
        // explicit names. Both are LAYERS, not one number.
        actual_total: c.settled, unpaid_total: c.committed_unpaid, spend_count: c.committed_count,
        priority: m.priority || null, flagged: !!m.flagged, flag_reason: m.flag_reason || null,
        dismissed: !!m.dismissed, complete: !!m.complete, ready_for_planning: !!m.ready_for_planning,
        reconciled: c.committed === 0 && c.settled > 0,
      };
    });
    // Priority-first (High → Medium → Low → none), then the two layers together.
    const prank = { High: 0, Medium: 1, Low: 2 };
    data.sort((a, b) => {
      const pa = prank[a.priority] ?? 3, pb = prank[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return (b.settled + b.committed) - (a.settled + a.committed) || (a.display < b.display ? -1 : 1);
    });

    res.json({
      success: true,
      data,
      meta: {
        scope: L.scope,
        // The gap this page exists to close: campaign spend the statements show
        // that names no artist. On the BANK basis, because that is what the
        // attribution queue lists.
        unattributed: {
          settled: L.unattributedSettled,
          committed: L.committedUnattributed,
          by_category: L.unattributedByCategory,
        },
        campaign_total: L.campaign_total,
        coverage_pct: L.coverage_pct,
        label_level: L.labelLevel,
        excluded: L.excluded,
        recoveries: L.recoveries,
        // How many in-scope rows the Settled layer had already counted, so
        // Committed left them alone. Not decoration: it is the guard's receipt.
        double_counted_prevented: L.doubleCountBlocked,
      },
    });
  } catch (error) {
    console.error('Artist campaigns index error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── The catch-up queue ──────────────────────────────────────────────────────
// GET /queue — every CAMPAIGN (an artist+song pair with in-scope invoices) that
// nobody has marked complete.
//
// KEYS. `song_campaign_status` is written with `artistKeyOf` + a lowercased
// song, so the finished join uses THOSE and not `artistBucketKey`. The two
// disagree on placeholders, and keying this the other way would list finished
// campaigns as outstanding.
//
// MONEY. `invoiced` and `unsettled` are INVOICE-side figures. The cards' Settled
// comes from the bank-basis rollup, which has no song dimension at all — a
// per-song number can only be built from the ledger. Different question, so
// different names; calling this "settled" would invite a comparison that cannot
// hold.
router.get('/queue', async (req, res) => {
  try {
    const cats = await S.loadCampaignCategories(pool, req.labelId);
    const keys = S.catKeys(cats);
    const accounts = await loadAccounts(pool, req.labelId);
    const { rows } = await pool.query(
      `SELECT e.id, e.artist, e.song, e.amount, e.currency, e.fx_rate_to_usd,
              e.payment_status, e.invoice_date, e.payee, e.category,
              LOWER(REGEXP_REPLACE(COALESCE(e.artist,''), '[^a-zA-Z0-9]', '', 'g')) AS akey,
              LOWER(TRIM(e.song)) AS skey,
              -- A split child inherits its parent's file, or every slice of one
              -- invoice reads as missing a document.
              ((e.invoice_r2_key IS NOT NULL OR e.invoice_filename IS NOT NULL)
               OR (p.invoice_r2_key IS NOT NULL OR p.invoice_filename IS NOT NULL)) AS has_invoice,
              ${bankEvidenceCols('e', accounts)}
         FROM expenses e
         JOIN expenses root ON root.id = COALESCE(e.parent_id, e.id) AND root.label_id = e.label_id
         LEFT JOIN expenses p ON p.id = e.parent_id AND p.label_id = e.label_id
         LEFT JOIN song_campaign_status scs
                ON scs.label_id = e.label_id
               AND scs.artist_key = LOWER(REGEXP_REPLACE(COALESCE(e.artist,''), '[^a-zA-Z0-9]', '', 'g'))
               AND scs.song_key = LOWER(TRIM(e.song))
        WHERE e.label_id = $1
          AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
          AND COALESCE(e.status, 'approved') IN ('approved', 'pending')
          AND ${S.inScopeSql('e', '$2')}
          -- A campaign needs both halves: no song is not a campaign, and no
          -- artist cannot be linked to a song subpage.
          AND COALESCE(TRIM(e.artist), '') <> '' AND COALESCE(TRIM(e.song), '') <> ''
          AND ${excludeBankRows('root')}
          AND NOT ${S.personExcludedSql('e', '$1')}
          AND COALESCE(scs.finished, FALSE) = FALSE`,
      [req.labelId, keys]
    );

    const byCampaign = new Map();
    const bump = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
    for (const r of rows) {
      const key = `${r.akey}|${r.skey}`;
      if (!byCampaign.has(key)) {
        byCampaign.set(key, {
          key, artist_key: r.akey, song_key: r.skey, artist: '', song: '',
          invoiced: 0, unsettled: 0, unpaid_total: 0,
          rows: 0, unpaid_count: 0, no_invoice_file_count: 0, unsettled_count: 0,
          flagged_no_bank_line: 0, oldest: null, newest: null,
          __artistNames: new Map(), __songNames: new Map(),
        });
      }
      const c = byCampaign.get(key);
      const usd = rowUsd(r);
      c.rows += 1;
      c.invoiced = round2(c.invoiced + usd);
      bump(c.__artistNames, String(r.artist).trim(), 1);
      bump(c.__songNames, String(r.song).trim(), 1);
      const paid = String(r.payment_status || '') === 'Paid';
      if (!paid) { c.unpaid_count += 1; c.unpaid_total = round2(c.unpaid_total + usd); }
      if (!r.has_invoice) c.no_invoice_file_count += 1;
      if (!r.bank_evidence) {
        c.unsettled_count += 1;
        c.unsettled = round2(c.unsettled + usd);
        if (paid && r.bank_expected) c.flagged_no_bank_line += 1;
      }
      const day = r.invoice_date ? String(r.invoice_date instanceof Date
        ? new Date(r.invoice_date.getTime() - r.invoice_date.getTimezoneOffset() * 60000).toISOString()
        : r.invoice_date).slice(0, 10) : null;
      if (day) {
        if (!c.oldest || day < c.oldest) c.oldest = day;
        if (!c.newest || day > c.newest) c.newest = day;
      }
    }

    const data = [...byCampaign.values()].map((c) => {
      const { __artistNames, __songNames, ...rest } = c;
      return { ...rest, artist: S.bestOf(__artistNames), song: S.bestOf(__songNames) };
    }).sort((a, b) => b.invoiced - a.invoiced || (a.artist < b.artist ? -1 : 1));

    // Campaigns with a song but no artist cannot be linked to a subpage, so they
    // are absent from `data` — disclosed rather than silently dropped.
    let unlinkable = { songs: null, rows: null };
    try {
      const { rows: [o] } = await pool.query(
        `SELECT COUNT(DISTINCT LOWER(TRIM(e.song)))::int AS songs, COUNT(*)::int AS rows
           FROM expenses e
           JOIN expenses root ON root.id = COALESCE(e.parent_id, e.id) AND root.label_id = e.label_id
          WHERE e.label_id = $1
            AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
            AND COALESCE(e.status, 'approved') IN ('approved', 'pending')
            AND ${S.inScopeSql('e', '$2')}
            AND COALESCE(TRIM(e.song), '') <> '' AND COALESCE(TRIM(e.artist), '') = ''
            AND ${excludeBankRows('root')}`,
        [req.labelId, keys]
      );
      unlinkable = { songs: o.songs, rows: o.rows };
    } catch { /* disclosed as unknown */ }

    res.json({
      success: true,
      data,
      meta: {
        scope: { categories: cats },
        // Reduced over the SAME list that is returned.
        count: data.length,
        invoiced: round2(data.reduce((t, c) => t + c.invoiced, 0)),
        unsettled: round2(data.reduce((t, c) => t + c.unsettled, 0)),
        with_unpaid: data.filter((c) => c.unpaid_count > 0).length,
        with_missing_invoice: data.filter((c) => c.no_invoice_file_count > 0).length,
        with_unsettled: data.filter((c) => c.unsettled_count > 0).length,
        clean: data.filter((c) => !c.unpaid_count && !c.no_invoice_file_count && !c.unsettled_count).length,
        unlinkable,
        basis: "invoice totals — the cards' Settled figure is bank-basis and has no song dimension",
      },
    });
  } catch (error) {
    console.error('Artist campaigns queue error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /scope — the resolved campaign categories, for the attribution queue which
// drills them one at a time through /reports/pnl/detail.
router.get('/scope', async (req, res) => {
  try {
    res.json({ success: true, data: { categories: await S.loadCampaignCategories(pool, req.labelId) } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /review-inbox — entries assigned to the current user (used by My Work).
router.get('/review-inbox', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.artist, e.song, e.amount, e.currency,
              (SELECT COUNT(*)::int FROM expense_comments c WHERE c.expense_id = e.id) AS comments
         FROM review_assignments ra JOIN expenses e ON e.id = ra.expense_id
        WHERE ra.label_id = $1 AND ra.assignee_id = $2 AND (e.deleted = false OR e.deleted IS NULL)
        ORDER BY ra.created_at DESC`,
      [req.labelId, req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /review-feed — flagged rows + flagged songs/artists + open comment threads.
router.get('/review-feed', async (req, res) => {
  try {
    const flaggedRows = (await pool.query(
      `SELECT e.id, e.payee, e.artist, e.song, e.amount, e.currency, e.flag_reason, e.flagged_at, e.flagged_by,
              (SELECT json_agg(json_build_object('id', u.id, 'name', u.name)) FROM review_assignments ra JOIN users u ON u.id = ra.assignee_id WHERE ra.expense_id = e.id) AS assignees,
              (SELECT COUNT(*)::int FROM expense_comments c WHERE c.expense_id = e.id) AS comment_count
         FROM expenses e WHERE e.label_id = $1 AND e.flagged = true AND (e.deleted = false OR e.deleted IS NULL)
        ORDER BY e.flagged_at DESC NULLS LAST LIMIT 100`,
      [req.labelId]
    )).rows;
    const flaggedSongs = (await pool.query('SELECT artist_key, song_key, flag_reason FROM song_campaign_status WHERE label_id = $1 AND flagged = true', [req.labelId])).rows;
    const flaggedArtists = (await pool.query('SELECT artist_key, flag_reason FROM artist_meta WHERE label_id = $1 AND flagged = true', [req.labelId])).rows;
    const openThreads = (await pool.query(
      `SELECT e.id, e.payee, e.artist, e.song, COUNT(c.id)::int AS comment_count,
              (ARRAY_AGG(c.body ORDER BY c.created_at DESC))[1] AS last_comment,
              (ARRAY_AGG(c.author ORDER BY c.created_at DESC))[1] AS last_comment_by,
              MAX(c.created_at) AS last_comment_at,
              (SELECT json_agg(json_build_object('id', u.id, 'name', u.name)) FROM review_assignments ra JOIN users u ON u.id = ra.assignee_id WHERE ra.expense_id = e.id) AS assignees
         FROM expense_comments c JOIN expenses e ON e.id = c.expense_id
        WHERE c.label_id = $1 AND (e.deleted = false OR e.deleted IS NULL)
        GROUP BY e.id, e.payee, e.artist, e.song ORDER BY MAX(c.created_at) DESC LIMIT 50`,
      [req.labelId]
    )).rows;
    res.json({ success: true, data: { flaggedRows, flaggedSongs, flaggedArtists, openThreads } });
  } catch (error) {
    console.error('review-feed error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /reviewers — the roster the assign picker offers.
router.get('/reviewers', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, role FROM users WHERE label_id = $1 ORDER BY name`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /review-assign — { expense_id, user_ids[] } replace-set.
router.post('/review-assign', async (req, res) => {
  const client = await pool.connect();
  try {
    const expenseId = parseInt(req.body.expense_id, 10);
    // NaN would reach Postgres as an integer type error → a 500 on a bad body.
    if (!Number.isInteger(expenseId)) return res.status(400).json({ success: false, error: 'expense_id is required' });
    const ids = Array.isArray(req.body.user_ids) ? req.body.user_ids.map((n) => parseInt(n, 10)).filter(Boolean) : [];
    const ent = await client.query('SELECT id FROM expenses WHERE id = $1 AND label_id = $2', [expenseId, req.labelId]);
    if (!ent.rows.length) { return res.status(404).json({ success: false, error: 'Entry not found' }); }
    // Reviewers must be in this workspace — a client-supplied id is never trusted.
    const ok = ids.length
      ? (await client.query('SELECT id FROM users WHERE label_id = $1 AND id = ANY($2::int[])', [req.labelId, ids])).rows.map((r) => r.id)
      : [];
    await client.query('BEGIN');
    await client.query('DELETE FROM review_assignments WHERE label_id = $1 AND expense_id = $2', [req.labelId, expenseId]);
    for (const uid of ok) {
      await client.query('INSERT INTO review_assignments (label_id, expense_id, assignee_id, assigned_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [req.labelId, expenseId, uid, req.user.name]);
    }
    await client.query('COMMIT');
    res.json({ success: true, data: { assigned: ok.length, requested: ids.length } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('review-assign error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { try { client.release(); } catch {} }
});

// ── Per-page chat rooms ────────────────────────────────────────────────────
router.get('/chat/:room', async (req, res) => {
  try {
    const msgs = (await pool.query(
      `SELECT m.id, m.body, m.user_id, m.edited_at, m.deleted, m.created_at, u.name AS author
         FROM campaign_chat_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.label_id = $1 AND m.room = $2 ORDER BY m.id ASC LIMIT 500`,
      [req.labelId, req.params.room]
    )).rows;
    res.json({ success: true, data: msgs });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/chat/:room', async (req, res) => {
  try {
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Empty message' });
    const { rows } = await pool.query(
      `INSERT INTO campaign_chat_messages (label_id, room, user_id, body) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [req.labelId, req.params.room, req.user.id, body.slice(0, 4000)]
    );
    recordMentions({ labelId: req.labelId, actorId: req.user.id, body, source: 'campaign_chat', sourceId: rows[0].id, link: '/artist-campaigns' }).catch(() => {});
    res.json({ success: true, data: { id: rows[0].id, body, user_id: req.user.id, author: req.user.name, created_at: rows[0].created_at } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/chat/:room/read', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO campaign_chat_reads (label_id, room, user_id, last_read_at) VALUES ($1,$2,$3,NOW())
       ON CONFLICT (label_id, room, user_id) DO UPDATE SET last_read_at = NOW()`,
      [req.labelId, req.params.room, req.user.id]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.put('/chat/messages/:id', async (req, res) => {
  try {
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Empty' });
    const upd = await pool.query(
      `UPDATE campaign_chat_messages SET body = $1, edited_at = NOW() WHERE id = $2 AND label_id = $3 AND user_id = $4 AND deleted = false RETURNING id`,
      [body, req.params.id, req.labelId, req.user.id]
    );
    if (!upd.rows.length) return res.status(403).json({ success: false, error: 'Cannot edit' });
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.delete('/chat/messages/:id', async (req, res) => {
  try {
    const upd = await pool.query(
      `UPDATE campaign_chat_messages SET deleted = true, body = '' WHERE id = $1 AND label_id = $2 AND ($3 = true OR user_id = $4) RETURNING id`,
      [req.params.id, req.labelId, isAdmin(req), req.user.id]
    );
    if (!upd.rows.length) return res.status(403).json({ success: false, error: 'Cannot delete' });
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Reclassification ────────────────────────────────────────────────────────
//
// The flag_dismissals row is what this page reads; `expenses.artist_campaign` is
// kept IN STEP with it so every other surface (the ledger's campaign column, the
// add-expense stamp, exports) agrees about the same row. Cadence's column is a
// BOOLEAN, so the states are TRUE (a person said yes) / FALSE (a person said no)
// / NULL (nobody has said) — the reference app wrote 'Yes'/'No' text.
async function syncCampaignMarker(db, labelId, ids, value) {
  if (!ids.length) return;
  await db.query('UPDATE expenses SET artist_campaign = $1 WHERE label_id = $2 AND id = ANY($3::int[])',
    [value, labelId, ids]);
}

router.post('/dismiss', async (req, res) => {
  try {
    const id = parseInt(req.body.expense_id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'expense_id required' });
    const own = await pool.query('SELECT id FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!own.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    await pool.query(
      `INSERT INTO flag_dismissals (label_id, expense_id, flag_kind, created_by) VALUES ($1,$2,'${S.DISMISS_KIND}',$3) ON CONFLICT DO NOTHING`,
      [req.labelId, id, req.user.name]
    );
    await syncCampaignMarker(pool, req.labelId, [id], false);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/restore', async (req, res) => {
  try {
    const id = parseInt(req.body.expense_id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'expense_id required' });
    await pool.query(`DELETE FROM flag_dismissals WHERE label_id = $1 AND expense_id = $2 AND flag_kind = '${S.DISMISS_KIND}'`, [req.labelId, id]);
    // Back to "nobody has said" — restoring is not the same as asserting yes.
    await syncCampaignMarker(pool, req.labelId, [id], null);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
// not-campaign toggle — cascades across the whole split family.
router.post('/not-campaign', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.body.expense_id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'expense_id is required' });
    const on = req.body.value !== false;
    const cur = await client.query('SELECT id, parent_id FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!cur.rows.length) { return res.status(404).json({ success: false, error: 'Not found' }); }
    const root = cur.rows[0].parent_id || id;
    const fam = await client.query('SELECT id FROM expenses WHERE label_id = $1 AND (id = $2 OR parent_id = $2)', [req.labelId, root]);
    const ids = fam.rows.map((f) => f.id);
    await client.query('BEGIN');
    if (on) {
      for (const fid of ids) {
        await client.query(`INSERT INTO flag_dismissals (label_id, expense_id, flag_kind, created_by) VALUES ($1,$2,'${S.NOT_CAMPAIGN_KIND}',$3) ON CONFLICT DO NOTHING`, [req.labelId, fid, req.user.name]);
      }
    } else {
      await client.query(`DELETE FROM flag_dismissals WHERE label_id = $1 AND expense_id = ANY($2::int[]) AND flag_kind = '${S.NOT_CAMPAIGN_KIND}'`, [req.labelId, ids]);
    }
    await syncCampaignMarker(client, req.labelId, ids, on ? false : null);
    await client.query('COMMIT');
    res.json({ success: true, data: { affected: ids.length } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('not-campaign error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { try { client.release(); } catch {} }
});

// ── Campaign linking ────────────────────────────────────────────────────────
router.post('/link', async (req, res) => {
  try {
    const campaignId = parseInt(req.body.campaign_id, 10);
    if (!Number.isFinite(campaignId)) return res.status(400).json({ success: false, error: 'campaign_id required' });
    const expenseId = req.body.expense_id ? parseInt(req.body.expense_id, 10) : null;
    if (expenseId) {
      const own = await pool.query('SELECT id FROM expenses WHERE id = $1 AND label_id = $2', [expenseId, req.labelId]);
      if (!own.rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    }
    const upd = await pool.query('UPDATE influencer_campaigns SET expense_id = $1 WHERE id = $2 AND label_id = $3 RETURNING id', [expenseId, campaignId, req.labelId]);
    if (!upd.rows.length) return res.status(404).json({ success: false, error: 'Campaign not found' });
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Song status (finished / notes / flag) ────────────────────────────────────
router.post('/song-status', async (req, res) => {
  try {
    const artistKey = normKey(req.body.artist);
    const songKey = songKeyOf(req.body.song);
    const b = req.body, who = req.user.name;
    if (b.finished === undefined && b.notes === undefined && b.flagged === undefined) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }
    await pool.query('INSERT INTO song_campaign_status (label_id, artist_key, song_key) VALUES ($1,$2,$3) ON CONFLICT (label_id, artist_key, song_key) DO NOTHING', [req.labelId, artistKey, songKey]);
    if (b.finished !== undefined) await pool.query('UPDATE song_campaign_status SET finished=$1, finished_at=NOW(), finished_by=$2 WHERE label_id=$3 AND artist_key=$4 AND song_key=$5', [!!b.finished, who, req.labelId, artistKey, songKey]);
    if (b.notes !== undefined) await pool.query('UPDATE song_campaign_status SET notes=$1, notes_updated_at=NOW(), notes_updated_by=$2 WHERE label_id=$3 AND artist_key=$4 AND song_key=$5', [b.notes || null, who, req.labelId, artistKey, songKey]);
    if (b.flagged !== undefined) await pool.query('UPDATE song_campaign_status SET flagged=$1, flag_reason=$2, flagged_at=NOW(), flagged_by=$3 WHERE label_id=$4 AND artist_key=$5 AND song_key=$6', [!!b.flagged, b.flag_reason || null, who, req.labelId, artistKey, songKey]);
    res.json({ success: true });
  } catch (error) {
    console.error('song-status error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Artist meta (priority / flag / complete / ready / dismiss) ────────────────
router.post('/artist-meta', async (req, res) => {
  try {
    const key = normKey(req.body.artist);
    if (!key) return res.status(400).json({ success: false, error: 'artist required' });
    await pool.query('INSERT INTO artist_meta (label_id, artist_key) VALUES ($1,$2) ON CONFLICT (label_id, artist_key) DO NOTHING', [req.labelId, key]);
    const b = req.body, who = req.user.name;
    if (b.priority !== undefined) {
      if (b.priority && !['High', 'Medium', 'Low'].includes(b.priority)) {
        return res.status(400).json({ success: false, error: 'priority must be High, Medium or Low' });
      }
      await pool.query('UPDATE artist_meta SET priority=$1, priority_updated_at=NOW(), priority_updated_by=$2 WHERE label_id=$3 AND artist_key=$4', [b.priority || null, who, req.labelId, key]);
    }
    if (b.flagged !== undefined) await pool.query('UPDATE artist_meta SET flagged=$1, flag_reason=$2, flagged_at=NOW(), flagged_by=$3 WHERE label_id=$4 AND artist_key=$5', [!!b.flagged, b.flag_reason || null, who, req.labelId, key]);
    if (b.complete !== undefined) await pool.query('UPDATE artist_meta SET complete=$1, complete_at=NOW(), complete_by=$2 WHERE label_id=$3 AND artist_key=$4', [!!b.complete, who, req.labelId, key]);
    if (b.ready_for_planning !== undefined) await pool.query('UPDATE artist_meta SET ready_for_planning=$1, ready_at=NOW(), ready_by=$2 WHERE label_id=$3 AND artist_key=$4', [!!b.ready_for_planning, who, req.labelId, key]);
    if (b.dismissed !== undefined) await pool.query('UPDATE artist_meta SET dismissed=$1, dismissed_at=NOW(), dismissed_by=$2 WHERE label_id=$3 AND artist_key=$4', [!!b.dismissed, who, req.labelId, key]);
    res.json({ success: true });
  } catch (error) {
    console.error('artist-meta error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Per-expense comments (row threads) ────────────────────────────────────────
router.get('/entries/:id/comments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.body, c.author, c.created_at FROM expense_comments c WHERE c.label_id = $1 AND c.expense_id = $2 ORDER BY c.id ASC`,
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/entries/:id/comments', async (req, res) => {
  try {
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Empty comment' });
    const id = parseInt(req.params.id, 10);
    const own = await pool.query('SELECT id FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!own.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    const { rows } = await pool.query(
      `INSERT INTO expense_comments (label_id, expense_id, author, body, created_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING id, created_at`,
      [req.labelId, id, req.user.name, body]
    );
    recordMentions({ labelId: req.labelId, actorId: req.user.id, body, source: 'expense_comment', sourceId: id, link: '/artist-campaigns' }).catch(() => {});
    res.json({ success: true, data: { id: rows[0].id, body, author: req.user.name, created_at: rows[0].created_at } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Per-row mutations for the campaigns surface ───────────────────────────────
router.post('/entries/:id/set', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cur = await pool.query('SELECT id FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!cur.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    const b = req.body, who = req.user.name;
    const set = (col, val) => pool.query(`UPDATE expenses SET ${col} = $1 WHERE id = $2 AND label_id = $3`, [val, id, req.labelId]);
    if (b.cobrand !== undefined) await set('cobrand', !!b.cobrand);
    if (b.artist_campaign !== undefined) await set('artist_campaign', b.artist_campaign === null ? null : !!b.artist_campaign);
    if (b.is_bulk_deal !== undefined) await set('is_bulk_deal', !!b.is_bulk_deal);
    if (b.artist !== undefined) await set('artist', b.artist || null);
    if (b.song !== undefined) await set('song', b.song || null);
    if (b.category !== undefined) await set('category', b.category || null);
    if (b.payment_status !== undefined) await set('payment_status', b.payment_status);
    if (b.bulk_deal_quantity !== undefined) await set('bulk_deal_quantity', b.bulk_deal_quantity || null);
    if (b.bulk_deal_unit !== undefined) await set('bulk_deal_unit', b.bulk_deal_unit || null);
    if (b.bulk_deal_completed !== undefined) await set('bulk_deal_completed', b.bulk_deal_completed || 0);
    if (b.item_finished !== undefined) await pool.query('UPDATE expenses SET item_finished = $1, item_finished_at = NOW(), item_finished_by = $2 WHERE id = $3 AND label_id = $4', [!!b.item_finished, who, id, req.labelId]);
    if (b.flagged !== undefined) await pool.query('UPDATE expenses SET flagged = $1, flag_reason = $2, flagged_at = NOW(), flagged_by = $3 WHERE id = $4 AND label_id = $5', [!!b.flagged, b.flag_reason || null, who, id, req.labelId]);
    if (b.social_handles !== undefined) await pool.query('UPDATE expenses SET social_handles = $1::jsonb WHERE id = $2 AND label_id = $3', [JSON.stringify(b.social_handles || []), id, req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('AC entry set error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Rename a song, everywhere it is written ──────────────────────────────────
// Three cascades in ONE transaction, because the ledger, the Release Tracker and
// the per-song finished/notes flags must move together or the rename leaves two
// of them describing a song that no longer exists.
//   1. expenses.song                    — the money
//   2. releases.project_name            — the tracker's title
//   3. song_campaign_status key move    — finished / notes / flags / ready
// The key move has a collision rule: if the destination key already carries
// status, the source row is DELETED rather than allowed to violate the unique
// index — the destination is the row a person has been working with.
router.post('/:artist/rename-song', async (req, res) => {
  const client = await pool.connect();
  try {
    const artistKey = normKey(req.params.artist);
    const fromKey = songKeyOf(req.body.from);
    const to = String(req.body.to || '').trim();
    if (!to) { return res.status(400).json({ success: false, error: 'New song name required' }); }
    const toKey = songKeyOf(to);
    if (toKey === S.NO_SONG_KEY) { return res.status(400).json({ success: false, error: 'A song needs a name' }); }

    await client.query('BEGIN');
    // The ledger. `song_key` is a JS rule (blank → __no_song__), so the rows are
    // selected for the artist and filtered here rather than in SQL.
    const cand = (await client.query(
      `SELECT id, song FROM expenses
        WHERE label_id = $1 AND LOWER(REGEXP_REPLACE(COALESCE(artist,''), '[^a-zA-Z0-9]', '', 'g')) = $2`,
      [req.labelId, artistKey]
    )).rows.filter((r) => songKeyOf(r.song) === fromKey);
    const ids = cand.map((r) => r.id);
    if (ids.length) {
      await client.query('UPDATE expenses SET song = $1 WHERE label_id = $2 AND id = ANY($3::int[])', [to, req.labelId, ids]);
    }

    // The Release Tracker.
    const rel = await client.query(
      `UPDATE releases SET project_name = $1
        WHERE label_id = $2 AND LOWER(TRIM(project_name)) = $3
          AND artist_id IN (SELECT id FROM artists WHERE label_id = $2
                             AND LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g')) = $4)
        RETURNING id`,
      [to, req.labelId, fromKey, artistKey]
    );

    // The per-song status row.
    let statusMoved = 0, statusDropped = 0;
    const dest = await client.query('SELECT id FROM song_campaign_status WHERE label_id = $1 AND artist_key = $2 AND song_key = $3', [req.labelId, artistKey, toKey]);
    if (dest.rows.length) {
      const del = await client.query('DELETE FROM song_campaign_status WHERE label_id = $1 AND artist_key = $2 AND song_key = $3 RETURNING id', [req.labelId, artistKey, fromKey]);
      statusDropped = del.rows.length;
    } else {
      const mv = await client.query('UPDATE song_campaign_status SET song_key = $1, updated_at = NOW() WHERE label_id = $2 AND artist_key = $3 AND song_key = $4 RETURNING id', [toKey, req.labelId, artistKey, fromKey]);
      statusMoved = mv.rows.length;
    }
    // Recoupment notes key on the same pair.
    await client.query(
      `UPDATE recoupment_notes SET song_key = $1 WHERE label_id = $2 AND artist_key = $3 AND song_key = $4
         AND NOT EXISTS (SELECT 1 FROM recoupment_notes d WHERE d.label_id = $2 AND d.artist_key = $3 AND d.song_key = $1)`,
      [toKey, req.labelId, artistKey, fromKey]
    ).catch(() => {});
    await client.query('COMMIT');

    await logActivity(req, 'Renamed campaign song', `${req.params.artist}: "${req.body.from || '(no song)'}" → "${to}" · ${ids.length} ledger row(s), ${rel.rows.length} release(s)`);
    res.json({ success: true, data: { moved: ids.length, releases: rel.rows.length, status_moved: statusMoved, status_dropped: statusDropped } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('rename-song error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { try { client.release(); } catch {} }
});

// ── Export (styled XLSX) ──────────────────────────────────────────────────────
// Per-song section bands with the release meta and a Finished / In-progress
// rail, a BANK column that says which of the four states each row is in, and a
// subtitle that names the basis of every figure on the sheet.
const XLSX_ROW_BAND = 'FFFAFAFA';
const XLSX_SECTION_BG = 'FFF3F4F6';
const XLSX_SUBTLE = 'FF6B7280';
const XLSX_THIN = { style: 'thin', color: { argb: 'FFE5E7EB' } };
const XLSX_RAIL_FINISHED = 'FF10B981';
const XLSX_RAIL_INPROGRESS = 'FFF59E0B';
const XLSX_STATUS_PAID_BG = 'FFECFDF5';
const XLSX_STATUS_PAID_FG = 'FF065F46';
const XLSX_STATUS_UNPAID_BG = 'FFFEE2E2';
const XLSX_STATUS_UNPAID_FG = 'FF991B1B';
const XLSX_CURRENCY_FMT = { USD: '"$"#,##0.00', EUR: '"€"#,##0.00', GBP: '"£"#,##0.00', JPY: '"¥"#,##0', CAD: '"CA$"#,##0.00', AUD: '"AU$"#,##0.00' };
const xlsxCurrencyFmt = (cur) => XLSX_CURRENCY_FMT[cur] || `"${cur || 'USD'} "#,##0.00`;
// The workbook accent is the WORKSPACE's, never a brand constant — cadence is
// multi-tenant and `labels.brand_color` is what every other surface renders.
const HEX = /^#?[0-9a-fA-F]{6}$/;
const argbOf = (hex, fallback) => (HEX.test(String(hex || '')) ? `FF${String(hex).replace('#', '').toUpperCase()}` : fallback);

const bankStateOf = (r) => {
  if (r.bank_evidence) return 'settled';
  if (String(r.payment_status || '') !== 'Paid') return 'unpaid';
  return r.bank_expected ? 'PAID, NO LINE' : 'no line yet';
};

router.get('/export', async (req, res) => {
  try {
    const scopeArtist = req.query.artist ? normKey(req.query.artist) : null;
    const scopeSong = req.query.song ? songKeyOf(req.query.song) : null;
    const cats = await S.loadCampaignCategories(pool, req.labelId);
    const keys = S.catKeys(cats);
    const accounts = await loadAccounts(pool, req.labelId);
    const brand = (await pool.query('SELECT accent_color, name FROM labels WHERE id = $1', [req.labelId])).rows[0] || {};
    const headerBg = argbOf(brand.accent_color, 'FF111827');

    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.artist, e.song, e.category, e.amount, e.currency, e.cobrand,
              e.payment_status, e.payment_date, e.invoice_date, e.rep, e.invoice_number, e.notes,
              e.parent_id, e.social_handles, e.item_finished, e.fx_rate_to_usd,
              ${bankEvidenceCols('e', accounts)}
         FROM expenses e
         JOIN expenses root ON root.id = COALESCE(e.parent_id, e.id) AND root.label_id = e.label_id
        WHERE e.label_id = $1
          AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
          AND COALESCE(e.status, 'approved') IN ('approved', 'pending')
          AND ${S.inScopeSql('e', '$2')}
          AND ${excludeBankRows('root')}
          AND NOT ${S.personExcludedSql('e', '$1')}
        ORDER BY e.invoice_date DESC NULLS LAST, e.id DESC`,
      [req.labelId, keys]
    );
    const scoped = rows
      .filter((r) => !scopeArtist || normKey(r.artist) === scopeArtist)
      .filter((r) => !scopeSong || songKeyOf(r.song) === scopeSong);

    const songStatus = (await pool.query('SELECT artist_key, song_key, finished, notes FROM song_campaign_status WHERE label_id = $1', [req.labelId])).rows;
    const statusOf = new Map(songStatus.map((s) => [`${s.artist_key}|${s.song_key}`, s]));
    const releases = (await pool.query(
      `SELECT r.project_name, r.release_type, r.release_date, a.name AS artist
         FROM releases r JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
        WHERE r.label_id = $1`, [req.labelId]
    )).rows;
    const relOf = new Map(releases.map((r) => [`${normKey(r.artist)}|${songKeyOf(r.project_name)}`, r]));

    const byArtist = new Map();
    for (const r of scoped) {
      const k = normKey(r.artist) || '(no artist)';
      if (!byArtist.has(k)) byArtist.set(k, { name: r.artist || '(no artist)', rows: [] });
      byArtist.get(k).rows.push(r);
    }

    const wb = new ExcelJS.Workbook();
    const usedNames = new Set();
    const safeName = (n) => {
      let s = String(n || 'Artist').replace(/[\\/*?[\]:]/g, '').slice(0, 28) || 'Artist';
      let x = s, i = 2;
      while (usedNames.has(x.toLowerCase())) x = `${s} ${i++}`.slice(0, 31);
      usedNames.add(x.toLowerCase());
      return x;
    };
    const HEADER = ['Date', 'Vendor', 'Category', 'Amount', 'Currency', 'USD', 'Bank', 'Status', 'Paid date', 'Rep', 'Socials', 'Invoice #', 'Notes'];

    for (const [akey, a] of byArtist) {
      const ws = wb.addWorksheet(safeName(a.name));
      const invoiced = round2(a.rows.reduce((t, r) => t + rowUsd(r), 0));
      const unsettled = round2(a.rows.filter((r) => !r.bank_evidence).reduce((t, r) => t + rowUsd(r), 0));
      const unpaid = round2(a.rows.filter((r) => String(r.payment_status || '') !== 'Paid').reduce((t, r) => t + rowUsd(r), 0));

      ws.addRow([a.name]);
      ws.getRow(1).font = { bold: true, size: 14 };
      const sub = ws.addRow([`Invoiced $${invoiced.toFixed(2)} · Unsettled $${unsettled.toFixed(2)} · Unpaid $${unpaid.toFixed(2)} — invoice-side totals; "Bank" says which have a statement line`]);
      sub.font = { size: 9, color: { argb: XLSX_SUBTLE } };
      ws.addRow([]);

      const hr = ws.addRow(HEADER);
      hr.eachCell((c) => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerBg } };
        c.border = { bottom: XLSX_THIN };
      });
      const headerRowNumber = hr.number;

      // Songs ordered by spend desc, then release date — the page's own order,
      // so the sheet reads like the screen it came from.
      const groups = new Map();
      for (const r of a.rows) {
        const sk = songKeyOf(r.song);
        if (!groups.has(sk)) groups.set(sk, { key: sk, name: r.song || '(no song)', rows: [], total: 0 });
        const g = groups.get(sk);
        g.rows.push(r);
        g.total = round2(g.total + rowUsd(r));
      }
      const ordered = [...groups.values()].sort((x, y) => y.total - x.total
        || String(relOf.get(`${akey}|${y.key}`)?.release_date || '').localeCompare(String(relOf.get(`${akey}|${x.key}`)?.release_date || '')));

      let band = false;
      for (const g of ordered) {
        const st = statusOf.get(`${akey}|${g.key}`) || {};
        const rel = relOf.get(`${akey}|${g.key}`);
        const gUnsettled = round2(g.rows.filter((r) => !r.bank_evidence).reduce((t, r) => t + rowUsd(r), 0));
        const sec = ws.addRow([
          g.name,
          rel ? `${rel.release_type || 'Release'}${rel.release_date ? ` · ${String(rel.release_date).slice(0, 10)}` : ''}` : '',
          st.finished ? 'Finished' : 'In progress',
          '', '', g.total, '', '', '', '', '', '',
          gUnsettled ? `${gUnsettled.toFixed(2)} unsettled` : 'all settled',
        ]);
        sec.eachCell((c, i) => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_SECTION_BG } };
          c.font = { bold: i <= 3, size: i === 1 ? 11 : 9 };
          if (i === 1) c.border = { left: { style: 'medium', color: { argb: st.finished ? XLSX_RAIL_FINISHED : XLSX_RAIL_INPROGRESS } } };
        });
        ws.getCell(`F${sec.number}`).numFmt = '"$"#,##0.00';

        for (const r of g.rows) {
          const socials = (Array.isArray(r.social_handles) ? r.social_handles : []).map((s) => `${s.platform || ''}:${s.handle || ''}`).join(', ');
          const d = r.payment_date || r.invoice_date;
          const row = ws.addRow([
            d ? new Date(d) : null, r.payee, r.category,
            Number(r.amount || 0), r.currency || 'USD', rowUsd(r),
            bankStateOf(r), r.payment_status || 'Unpaid',
            r.payment_date ? new Date(r.payment_date) : null,
            r.rep || '', socials, r.invoice_number || '', r.notes || '',
          ]);
          if (band) row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_ROW_BAND } }; });
          band = !band;
          row.getCell(1).numFmt = 'yyyy-mm-dd';
          row.getCell(9).numFmt = 'yyyy-mm-dd';
          row.getCell(4).numFmt = xlsxCurrencyFmt(r.currency);
          row.getCell(6).numFmt = '"$"#,##0.00';
          const paid = String(r.payment_status || '') === 'Paid';
          const sc = row.getCell(8);
          sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: paid ? XLSX_STATUS_PAID_BG : XLSX_STATUS_UNPAID_BG } };
          sc.font = { color: { argb: paid ? XLSX_STATUS_PAID_FG : XLSX_STATUS_UNPAID_FG }, bold: true, size: 9 };
          if (bankStateOf(r) === 'PAID, NO LINE') row.getCell(7).font = { color: { argb: XLSX_STATUS_UNPAID_FG }, bold: true, size: 9 };
        }
      }

      ws.columns.forEach((col, i) => { col.width = [12, 26, 18, 12, 9, 12, 14, 10, 12, 14, 26, 14, 30][i] || 14; });
      ws.views = [{ state: 'frozen', ySplit: headerRowNumber }];
      ws.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: headerRowNumber, column: HEADER.length } };
    }
    if (!byArtist.size) wb.addWorksheet('Empty').addRow(['No campaign spend for this scope.']);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="artist-campaigns${scopeArtist ? '-' + scopeArtist : ''}-${today()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('AC export error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// ══ ARTIST DETAIL (param route LAST) ═══════════════════════════════════════
//
// The row list is deliberately NOT scoped: this page is where you look at
// EVERYTHING for an artist, and hiding their Legal or Recording rows loses
// context people rely on. So every row arrives and carries `in_scope`, and the
// FLAG decides which rows the TOTALS may include — which is what lets those
// totals agree with the artist's card. Same for `family_source`: a split child
// is inserted without `entry_source`, so a slice of a bank-born payment reads as
// an invoice; the row stays LISTED and the total excludes it.
router.get('/:artist', async (req, res) => {
  try {
    const raw = decodeURIComponent(req.params.artist || '');
    const isUnassigned = raw.toLowerCase() === 'unassigned';
    const artistKey = normKey(raw);
    const includeDismissed = req.query.include_dismissed === 'true';
    const cats = await S.loadCampaignCategories(pool, req.labelId);
    const keys = S.catKeys(cats);
    const accounts = await loadAccounts(pool, req.labelId);
    const admin = isAdmin(req);

    const artistPredicate = isUnassigned
      ? `COALESCE(TRIM(e.artist), '') = ''`
      : `LOWER(REGEXP_REPLACE(COALESCE(e.artist,''), '[^a-zA-Z0-9]', '', 'g')) = $3`;
    const params = isUnassigned ? [req.labelId, keys] : [req.labelId, keys, artistKey];

    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.artist, e.song, e.category, e.amount, e.currency, e.cobrand,
              e.payment_status, e.payment_date, e.invoice_date, e.created_at, e.rep, e.invoice_number,
              e.parent_id, e.entry_source, e.social_handles, e.item_finished, e.item_finished_by,
              e.flagged, e.flag_reason, e.flagged_by, e.notes, e.description,
              e.ufr, e.ufr_marked_at, e.recoupable, e.status,
              e.is_bulk_deal, e.bulk_deal_quantity, e.bulk_deal_unit, e.bulk_deal_completed, e.fx_rate_to_usd,
              root.entry_source AS family_source,
              ${S.inScopeSql('e', '$2')} AS in_scope,
              (e.invoice_r2_key IS NOT NULL OR e.invoice_filename IS NOT NULL) AS has_invoice,
              (p.invoice_r2_key IS NOT NULL OR p.invoice_filename IS NOT NULL) AS parent_has_invoice,
              p.social_handles AS parent_social_handles,
              COALESCE(bdi.delivered, 0)::int AS bulk_delivered,
              COALESCE(bdi.total, 0)::int AS bulk_items_total,
              bdi.evidence AS bulk_evidence,
              (SELECT COUNT(*)::int FROM expense_comments c WHERE c.expense_id = e.id) AS comment_count,
              (SELECT json_agg(json_build_object('id', u.id, 'name', u.name)) FROM review_assignments ra JOIN users u ON u.id = ra.assignee_id WHERE ra.expense_id = e.id) AS review_assignees,
              -- TWO link directions, and both are real: an influencer campaign
              -- points AT its invoice, while an ad allocation's slices point BACK
              -- at their campaign. Reading only the first leaves every allocated
              -- ad slice showing no campaign at all.
              COALESCE(e.campaign_id, (SELECT ic.id FROM influencer_campaigns ic WHERE ic.expense_id = e.id AND ic.label_id = e.label_id LIMIT 1)) AS campaign_id,
              COALESCE((SELECT cb.name FROM campaigns cb WHERE cb.id = e.campaign_id AND cb.label_id = e.label_id),
                       (SELECT ic.name FROM influencer_campaigns ic WHERE ic.expense_id = e.id AND ic.label_id = e.label_id LIMIT 1)) AS campaign_name,
              ${S.dismissedSql('e', '$1')} AS dismissed,
              ${S.notCampaignSql('e', '$1')} AS not_campaign,
              ${bankEvidenceCols('e', accounts)}
         FROM expenses e
         LEFT JOIN expenses p ON p.id = e.parent_id AND p.label_id = e.label_id
         JOIN expenses root ON root.id = COALESCE(e.parent_id, e.id) AND root.label_id = e.label_id
         LEFT JOIN (
           SELECT expense_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE completed) AS delivered,
                  jsonb_agg(jsonb_build_object('title', title, 'url', url, 'completed', completed) ORDER BY position, id)
                    FILTER (WHERE url IS NOT NULL AND url <> '') AS evidence
             FROM bulk_deal_items WHERE label_id = $1 GROUP BY expense_id
         ) bdi ON bdi.expense_id = e.id
        WHERE e.label_id = $1
          AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
          AND COALESCE(e.status, 'approved') IN ('approved', 'pending')
          AND ${artistPredicate}
        ORDER BY e.invoice_date DESC NULLS LAST, e.id DESC`,
      params
    );

    // Dismissed rows are hidden unless the tray asked for them; not-a-campaign
    // rows are segregated, and non-admins never receive them at all.
    const visible = rows
      .filter((r) => includeDismissed || !r.dismissed)
      .filter((r) => admin || !r.not_campaign);
    const dismissedCount = rows.filter((r) => r.dismissed).length;

    let invoiced = 0, settledTotal = 0, unsettled = 0, cobrand = 0, unpaid = 0;
    let unpaidCount = 0, noBankLineCount = 0, outOfScopeCount = 0, outOfScopeTotal = 0;
    const byCat = {}, byCurrency = {}, cobrandBySong = {};
    const entries = [];
    for (const r of visible) {
      const usd = rowUsd(r);
      const counted = r.in_scope && !r.not_campaign && !r.dismissed && r.family_source !== 'bank_statement';
      entries.push({
        ...r,
        amount_usd: usd,
        song_key: songKeyOf(r.song),
        counted,
        social_handles: (Array.isArray(r.social_handles) && r.social_handles.length)
          ? r.social_handles
          : (r.parent_id && Array.isArray(r.parent_social_handles) ? r.parent_social_handles : r.social_handles),
        socials_inherited: !!(r.parent_id && !(Array.isArray(r.social_handles) && r.social_handles.length) && Array.isArray(r.parent_social_handles) && r.parent_social_handles.length),
        has_invoice: r.has_invoice || r.parent_has_invoice,
      });
      if (!counted) {
        if (!r.in_scope && !r.dismissed) { outOfScopeCount += 1; outOfScopeTotal = round2(outOfScopeTotal + usd); }
        continue;
      }
      invoiced = round2(invoiced + usd);
      byCat[r.category || 'Uncategorized'] = round2((byCat[r.category || 'Uncategorized'] || 0) + usd);
      byCurrency[r.currency || 'USD'] = round2((byCurrency[r.currency || 'USD'] || 0) + Number(r.amount || 0));
      if (r.bank_evidence) settledTotal = round2(settledTotal + usd);
      else {
        unsettled = round2(unsettled + usd);
        if (String(r.payment_status || '') === 'Paid' && r.bank_expected) noBankLineCount += 1;
      }
      if (String(r.payment_status || '') !== 'Paid') { unpaid = round2(unpaid + usd); unpaidCount += 1; }
      if (r.cobrand) {
        cobrand = round2(cobrand + usd);
        const sk = songKeyOf(r.song);
        cobrandBySong[sk] = round2((cobrandBySong[sk] || 0) + usd);
      }
    }

    const displayName = isUnassigned ? 'Not attributed to an artist'
      : (S.bestOf(new Map(Object.entries(rows.reduce((m, r) => {
        const n = String(r.artist || '').trim();
        if (n) m[n] = (m[n] || 0) + 1;
        return m;
      }, {})))) || raw);

    const [releases, songStatus, campaigns, meta, adCampaigns] = await Promise.all([
      pool.query(`SELECT id, project_name, release_type, release_date FROM releases WHERE label_id = $1 AND artist_id IN (SELECT id FROM artists WHERE label_id = $1 AND LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g')) = $2) ORDER BY release_date DESC NULLS LAST`, [req.labelId, artistKey]).catch(() => ({ rows: [] })),
      pool.query('SELECT song_key, finished, finished_by, notes, notes_updated_by, notes_updated_at, flagged, flag_reason, ready_for_planning FROM song_campaign_status WHERE label_id = $1 AND artist_key = $2', [req.labelId, artistKey]),
      pool.query(`SELECT id, name, planned_amount, currency, expense_id, song FROM influencer_campaigns WHERE label_id = $1 AND LOWER(REGEXP_REPLACE(COALESCE(artist,''), '[^a-zA-Z0-9]', '', 'g')) = $2 ORDER BY id DESC`, [req.labelId, artistKey]).catch(() => ({ rows: [] })),
      pool.query('SELECT * FROM artist_meta WHERE label_id = $1 AND artist_key = $2', [req.labelId, artistKey]),
      pool.query(`SELECT c.id, c.name, c.platform, c.start_date FROM campaigns c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id WHERE c.label_id = $1 AND LOWER(REGEXP_REPLACE(COALESCE(a.name,''), '[^a-zA-Z0-9]', '', 'g')) = $2 ORDER BY c.start_date DESC NULLS LAST`, [req.labelId, artistKey]).catch(() => ({ rows: [] })),
    ]);

    res.json({ success: true, data: {
      artist: displayName, artist_key: artistKey, unassigned: isUnassigned,
      entries,
      totals: {
        invoiced, settled: settledTotal, unsettled, no_bank_line_count: noBankLineCount,
        cobrand, unpaid, unpaid_count: unpaidCount,
        out_of_scope: { count: outOfScopeCount, total: outOfScopeTotal },
        by_currency: byCurrency,
        // Kept so any reader not yet re-pointed still shows a real number. It is
        // the INVOICE-side figure and the client labels it as such.
        spend: invoiced,
      },
      categories: Object.entries(byCat).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total),
      cobrand_by_song: cobrandBySong,
      releases: releases.rows, song_status: songStatus.rows, campaigns: campaigns.rows,
      ad_campaigns: adCampaigns.rows, meta: meta.rows[0] || {},
      dismissed_count: dismissedCount,
      scope: { categories: cats, basis: 'invoice totals — the card\'s Settled figure is bank-basis' },
    } });
  } catch (error) {
    console.error('Artist campaign detail error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

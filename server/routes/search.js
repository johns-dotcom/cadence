const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { excludeCreatorRows } = require('../lib/ledgerSource');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/search?q=… — workspace-wide search across the core entities. Every
// query is anchored to req.labelId, so results never cross tenants.
//
// Two permission tiers, each mirroring the gate on the page a result links to
// rather than restating a rule of its own:
//   · contracts   → /contracts is Approver+ (routes/contracts.js)
//   · vendors +
//     ledger rows → the finance surface is Approver+ (routes/ledger.js:108
//                   `router.use(requireApprover)`). Offering a vendor to
//                   someone who would 403 on the click is worse than not
//                   finding it. The role comes off the request user, which
//                   auth middleware re-reads from the row every request, so
//                   there is no stale-token path that opens this up.
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  const EMPTY = { releases: [], artists: [], contracts: [], deals: [], vendors: [], entries: [] };
  if (q.length < 2) return res.json({ success: true, data: EMPTY });

  const like = `%${q}%`;
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(req.user.role);
  const none = Promise.resolve({ rows: [] });
  try {
    const [releases, artists, contracts, deals, vendors, entries] = await Promise.all([
      // Archived releases are off the shelf: they don't appear on /releases and
      // clicking one from here lands on a record the list won't show back.
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, r.release_type, r.genre,
                r.upc, r.isrc, a.name AS artist_name
         FROM releases r
         LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
         WHERE r.label_id = $1
           AND (r.archived = false OR r.archived IS NULL)
           AND (r.project_name ILIKE $2 OR r.upc ILIKE $2 OR r.isrc ILIKE $2 OR a.name ILIKE $2)
         ORDER BY r.release_date DESC NULLS LAST LIMIT 8`,
        [req.labelId, like]
      ),
      // Ordered by catalogue depth, not alphabetically: the artist you mean is
      // overwhelmingly the one with the most releases. total_releases is derived
      // here (there is no such column) exactly the way /artists derives it.
      pool.query(
        `SELECT a.id, a.name, a.genre,
                (SELECT COUNT(*)::int FROM releases r
                  WHERE r.artist_id = a.id AND r.label_id = a.label_id
                    AND (r.archived = false OR r.archived IS NULL)) AS total_releases
         FROM artists a
         WHERE a.label_id = $1 AND a.name ILIKE $2
         ORDER BY total_releases DESC, a.name LIMIT 6`,
        [req.labelId, like]
      ),
      isApprover
        ? pool.query(
            `SELECT c.id, c.type, c.status, c.expiration_date, a.name AS artist_name
             FROM contracts c
             LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
             WHERE c.label_id = $1 AND (c.type ILIKE $2 OR a.name ILIKE $2)
             ORDER BY c.expiration_date ASC NULLS LAST LIMIT 6`,
            [req.labelId, like]
          )
        : none,
      pool.query(
        `SELECT id, artist_name, stage, genre, ar_rep FROM deals
         WHERE label_id = $1 AND artist_name ILIKE $2 ORDER BY updated_at DESC LIMIT 6`,
        [req.labelId, like]
      ),

      // ── Vendors ──────────────────────────────────────────────────────────
      // The vendor directory is DERIVED from expenses.payee, not a table (see
      // GET /ledger/vendors), so this groups the same way and applies the same
      // deleted/voided/approved scoping. A vendor the directory won't show must
      // not be findable here either.
      //
      // Aliases are searched too: vendor_aliases is how one payee's other
      // spellings are recorded, and someone typing the name printed on the
      // invoice in their hand is the case that table exists for. The alias hit
      // still resolves to the PRIMARY name — one vendor, one result, never the
      // alias masquerading as a vendor of its own.
      !isApprover ? none : pool.query(
        `SELECT e.payee,
                COUNT(*) FILTER (WHERE e.parent_id IS NULL)::int AS invoice_count,
                COALESCE(SUM(e.amount), 0) AS total_spent,
                MAX(e.invoice_date) AS last_invoice
           FROM expenses e
          WHERE e.label_id = $1
            AND (e.deleted = false OR e.deleted IS NULL)
            AND (e.voided = false OR e.voided IS NULL)
            AND e.payee IS NOT NULL AND e.payee <> ''
            AND e.status = 'approved'
            -- Creators are not vendors. Offering one here would open a page
            -- built for W9s and payment terms about somebody who has neither;
            -- they are findable on /creators.
            AND ${excludeCreatorRows('e')}
            AND (e.payee ILIKE $2
                 OR EXISTS (SELECT 1 FROM vendor_aliases va
                             WHERE va.label_id = e.label_id
                               AND LOWER(va.canonical) = LOWER(e.payee)
                               AND va.alias ILIKE $2))
          GROUP BY e.payee
          ORDER BY SUM(e.amount) DESC NULLS LAST
          LIMIT 6`,
        [req.labelId, like]
      ),

      // ── Ledger entries ───────────────────────────────────────────────────
      // Invoice number, payee and description, so a piece of paper on the desk
      // can be found by whatever is printed on it. LEAF ROWS ONLY — a split
      // parent's children carry the real attribution, and returning both would
      // offer the same money twice under two ids.
      !isApprover ? none : pool.query(
        `SELECT e.id, e.payee, e.invoice_number, e.amount, e.currency,
                e.invoice_date, e.payment_status, e.artist, e.category
           FROM expenses e
          WHERE e.label_id = $1
            AND (e.deleted = false OR e.deleted IS NULL)
            AND (e.voided = false OR e.voided IS NULL)
            AND NOT EXISTS (SELECT 1 FROM expenses c
                             WHERE c.parent_id = e.id AND c.label_id = e.label_id)
            AND (e.invoice_number ILIKE $2 OR e.payee ILIKE $2 OR e.description ILIKE $2)
          ORDER BY e.invoice_date DESC NULLS LAST
          LIMIT 6`,
        [req.labelId, like]
      ),
    ]);

    res.json({
      success: true,
      data: {
        releases: releases.rows,
        artists: artists.rows,
        contracts: contracts.rows,
        deals: deals.rows,
        vendors: vendors.rows,
        entries: entries.rows,
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

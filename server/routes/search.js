const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/search?q=… — workspace-wide search across the core entities. Every
// query is anchored to req.labelId, so results never cross tenants. Contracts
// are only searched for admins/approvers (mirrors the page-level gate).
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.json({ success: true, data: { releases: [], artists: [], contracts: [], deals: [] } });
  }
  const like = `%${q}%`;
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(req.user.role);
  try {
    const [releases, artists, contracts, deals] = await Promise.all([
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, a.name AS artist_name
         FROM releases r
         LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
         WHERE r.label_id = $1
           AND (r.project_name ILIKE $2 OR r.upc ILIKE $2 OR r.isrc ILIKE $2 OR a.name ILIKE $2)
         ORDER BY r.release_date DESC NULLS LAST LIMIT 8`,
        [req.labelId, like]
      ),
      pool.query(
        `SELECT id, name, genre FROM artists
         WHERE label_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 6`,
        [req.labelId, like]
      ),
      isApprover
        ? pool.query(
            `SELECT c.id, c.type, c.status, a.name AS artist_name
             FROM contracts c
             LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
             WHERE c.label_id = $1 AND (c.type ILIKE $2 OR a.name ILIKE $2)
             ORDER BY c.updated_at DESC LIMIT 6`,
            [req.labelId, like]
          )
        : Promise.resolve({ rows: [] }),
      pool.query(
        `SELECT id, artist_name, stage, genre FROM deals
         WHERE label_id = $1 AND artist_name ILIKE $2 ORDER BY updated_at DESC LIMIT 6`,
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
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

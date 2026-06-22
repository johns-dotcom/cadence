const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
// Data-quality + merges are destructive — admin only, always label-scoped.
router.use(authMiddleware, withTenant, requireAdmin);

// GET /api/flags — surface data-quality issues for this workspace:
//   • duplicate artists  (case-insensitive same name)
//   • duplicate releases (same project_name)
//   • duplicate vendors  (case-insensitive same payee in the ledger)
//   • releases with an incomplete prep checklist near their release date
router.get('/', async (req, res) => {
  try {
    const [dupArtists, dupReleases, dupVendors] = await Promise.all([
      pool.query(
        `SELECT LOWER(name) AS key, ARRAY_AGG(json_build_object('id', id, 'name', name) ORDER BY id) AS items, COUNT(*)::int AS n
         FROM artists WHERE label_id = $1 GROUP BY LOWER(name) HAVING COUNT(*) > 1`,
        [req.labelId]
      ),
      pool.query(
        `SELECT LOWER(project_name) AS key, ARRAY_AGG(json_build_object('id', id, 'name', project_name) ORDER BY id) AS items, COUNT(*)::int AS n
         FROM releases WHERE label_id = $1 GROUP BY LOWER(project_name) HAVING COUNT(*) > 1`,
        [req.labelId]
      ),
      pool.query(
        `SELECT LOWER(payee) AS key, ARRAY_AGG(DISTINCT payee) AS names, COUNT(DISTINCT payee)::int AS n
         FROM expenses WHERE label_id = $1 AND payee IS NOT NULL AND payee != '' AND (deleted = false OR deleted IS NULL)
         GROUP BY LOWER(payee) HAVING COUNT(DISTINCT payee) > 1`,
        [req.labelId]
      ),
    ]);
    res.json({
      success: true,
      data: {
        duplicate_artists: dupArtists.rows,
        duplicate_releases: dupReleases.rows,
        duplicate_vendors: dupVendors.rows.map(r => ({ key: r.key, names: r.names })),
      },
    });
  } catch (error) {
    console.error('Flags error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/flags/merge-artists { source_id, target_id } — reassign everything
// the source artist owns to the target, then delete the source. Both ids are
// re-validated against the caller's label before anything moves.
router.post('/merge-artists', async (req, res) => {
  const client = await pool.connect();
  try {
    const sourceId = parseInt(req.body.source_id, 10);
    const targetId = parseInt(req.body.target_id, 10);
    if (!sourceId || !targetId || sourceId === targetId) {
      return res.status(400).json({ success: false, error: 'Pick two different artists' });
    }
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, name FROM artists WHERE id = ANY($1::int[]) AND label_id = $2',
      [[sourceId, targetId], req.labelId]
    );
    if (rows.length !== 2) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Artist not found in this workspace' }); }
    const target = rows.find(r => r.id === targetId);
    const source = rows.find(r => r.id === sourceId);

    // Reassign FK references (all label-scoped).
    await client.query('UPDATE releases SET artist_id = $1 WHERE artist_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    await client.query('UPDATE contracts SET artist_id = $1 WHERE artist_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    await client.query('UPDATE artist_income SET artist_id = $1 WHERE artist_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    await client.query('UPDATE campaigns SET artist_id = $1 WHERE artist_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    await client.query('UPDATE artist_dev_log SET artist_id = $1 WHERE artist_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    // Move ledger rows keyed by artist NAME too.
    await client.query('UPDATE expenses SET artist = $1 WHERE LOWER(artist) = LOWER($2) AND label_id = $3', [target.name, source.name, req.labelId]);
    await client.query('DELETE FROM artists WHERE id = $1 AND label_id = $2', [sourceId, req.labelId]);

    await client.query('COMMIT');
    await logActivity(req, 'Merged artists', `${source.name} → ${target.name}`);
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Merge artists error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/flags/merge-releases { source_id, target_id } — fold the source
// release's DSP rows into the target where missing, then delete the source.
router.post('/merge-releases', async (req, res) => {
  const client = await pool.connect();
  try {
    const sourceId = parseInt(req.body.source_id, 10);
    const targetId = parseInt(req.body.target_id, 10);
    if (!sourceId || !targetId || sourceId === targetId) {
      return res.status(400).json({ success: false, error: 'Pick two different releases' });
    }
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id FROM releases WHERE id = ANY($1::int[]) AND label_id = $2', [[sourceId, targetId], req.labelId]);
    if (rows.length !== 2) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Release not found in this workspace' }); }

    // Move DSP rows that don't collide; drop the rest; reassign tasks.
    await client.query(
      `UPDATE dsp_submissions s SET release_id = $1
       WHERE s.release_id = $2 AND s.label_id = $3
         AND NOT EXISTS (SELECT 1 FROM dsp_submissions t WHERE t.release_id = $1 AND t.platform = s.platform)`,
      [targetId, sourceId, req.labelId]
    );
    await client.query('DELETE FROM dsp_submissions WHERE release_id = $1 AND label_id = $2', [sourceId, req.labelId]);
    await client.query('UPDATE tasks SET release_id = $1 WHERE release_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    await client.query('DELETE FROM releases WHERE id = $1 AND label_id = $2', [sourceId, req.labelId]);

    await client.query('COMMIT');
    await logActivity(req, 'Merged releases', `#${sourceId} → #${targetId}`);
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Merge releases error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/flags/merge-vendors { source_name, target_name } — rename a vendor
// across every ledger row, folding the source into the target.
router.post('/merge-vendors', async (req, res) => {
  const client = await pool.connect();
  try {
    const source = (req.body.source_name || '').trim();
    const target = (req.body.target_name || '').trim();
    if (!source || !target || source.toLowerCase() === target.toLowerCase()) {
      return res.status(400).json({ success: false, error: 'Pick two different vendor names' });
    }
    await client.query('BEGIN');
    await client.query('UPDATE expenses SET payee = $1 WHERE LOWER(payee) = LOWER($2) AND label_id = $3', [target, source, req.labelId]);
    await client.query('UPDATE expenses SET vendor_name = $1 WHERE LOWER(vendor_name) = LOWER($2) AND label_id = $3', [target, source, req.labelId]);
    // Drop the now-redundant source vendor record if a target one exists.
    await client.query('DELETE FROM vendors WHERE LOWER(name) = LOWER($1) AND label_id = $2 AND EXISTS (SELECT 1 FROM vendors WHERE LOWER(name) = LOWER($3) AND label_id = $2)', [source, req.labelId, target]);
    await client.query('UPDATE vendors SET name = $1 WHERE LOWER(name) = LOWER($2) AND label_id = $3', [target, source, req.labelId]);
    await client.query('COMMIT');
    await logActivity(req, 'Merged vendors', `${source} → ${target}`);
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Merge vendors error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;

const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { DSP_PLATFORMS, DSP_STATUSES } = require('../lib/constants');

const router = express.Router();
router.use(authMiddleware, withTenant);

// Confirm a release belongs to the caller's workspace before touching its DSP
// rows — never trust a client-supplied release id across tenants.
async function releaseInLabel(releaseId, labelId) {
  const { rows } = await pool.query('SELECT 1 FROM releases WHERE id = $1 AND label_id = $2', [releaseId, labelId]);
  return rows.length > 0;
}

// GET /api/dsp/:releaseId — submission status across every tracked platform.
// Platforms without a row yet are returned as "Not Submitted" so the UI shows
// the full grid.
router.get('/:releaseId', async (req, res) => {
  try {
    const releaseId = parseInt(req.params.releaseId, 10);
    if (!(await releaseInLabel(releaseId, req.labelId))) {
      return res.status(404).json({ success: false, error: 'Release not found' });
    }
    const { rows } = await pool.query(
      `SELECT platform, status, submitted_date, live_date, notes
       FROM dsp_submissions WHERE label_id = $1 AND release_id = $2`,
      [req.labelId, releaseId]
    );
    const byPlatform = Object.fromEntries(rows.map(r => [r.platform, r]));
    const data = DSP_PLATFORMS.map(p => byPlatform[p] || { platform: p, status: 'Not Submitted', submitted_date: null, live_date: null, notes: null });
    res.json({ success: true, data });
  } catch (error) {
    console.error('List DSP error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/dsp/:releaseId — upsert one platform's status for a release.
router.put('/:releaseId', async (req, res) => {
  try {
    const releaseId = parseInt(req.params.releaseId, 10);
    const { platform } = req.body;
    if (!DSP_PLATFORMS.includes(platform)) return res.status(400).json({ success: false, error: 'Unknown platform' });
    const status = DSP_STATUSES.includes(req.body.status) ? req.body.status : 'Not Submitted';
    if (!(await releaseInLabel(releaseId, req.labelId))) {
      return res.status(404).json({ success: false, error: 'Release not found' });
    }
    const { rows } = await pool.query(
      `INSERT INTO dsp_submissions (label_id, release_id, platform, status, submitted_date, live_date, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (release_id, platform)
       DO UPDATE SET status = EXCLUDED.status, submitted_date = EXCLUDED.submitted_date,
                     live_date = EXCLUDED.live_date, notes = EXCLUDED.notes, updated_at = NOW()
       RETURNING platform, status, submitted_date, live_date, notes`,
      [req.labelId, releaseId, platform, status, req.body.submitted_date || null, req.body.live_date || null, req.body.notes || null]
    );
    await logActivity(req, 'Updated DSP status', `${platform} → ${status}`);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update DSP error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

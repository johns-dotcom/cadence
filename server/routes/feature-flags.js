const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { resolveFlags } = require('../lib/featureFlags');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/feature-flags — the effective flag map for the caller's workspace.
router.get('/', async (req, res) => {
  try {
    const flags = await resolveFlags(pool, req.labelId);
    res.json({ success: true, data: { flags } });
  } catch (error) {
    console.error('Feature flags error:', error);
    // Fail open — never let a flag lookup break the app.
    res.json({ success: true, data: { flags: {} } });
  }
});

module.exports = router;

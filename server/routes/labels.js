const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile } = require('../lib/r2');

const router = express.Router();
router.use(authMiddleware, withTenant);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const HEX_RE = /^#([0-9a-fA-F]{6})$/;

// Resolve a short-lived signed URL for the label's logo (null if none/unset).
async function logoUrl(r2Key) {
  if (!r2Key) return null;
  try { return await getSignedFileUrl(r2Key, 6 * 3600); } catch { return null; }
}

// GET /api/label — current workspace settings + branding
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug, accent_color, logo_r2_key, created_at,
              (SELECT COUNT(*) FROM users WHERE label_id = labels.id) AS member_count
       FROM labels WHERE id = $1`,
      [req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const label = rows[0];
    label.logo_url = await logoUrl(label.logo_r2_key);
    delete label.logo_r2_key;
    res.json({ success: true, data: label });
  } catch (error) {
    console.error('Get label error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/label — rename + set accent color (admin only). Slug is immutable.
router.patch('/', requireAdmin, async (req, res) => {
  try {
    const { name, accent_color } = req.body;

    if (accent_color !== undefined && accent_color !== null && accent_color !== '' && !HEX_RE.test(accent_color)) {
      return res.status(400).json({ success: false, error: 'Accent color must be a hex value like #4F46E5' });
    }
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Name cannot be empty' });
    }

    // Empty string clears the accent (back to Cadence default).
    const accentValue = accent_color === '' ? null : accent_color;

    const { rows } = await pool.query(
      `UPDATE labels SET
         name = COALESCE($1, name),
         accent_color = CASE WHEN $2::boolean THEN $3 ELSE accent_color END
       WHERE id = $4
       RETURNING id, name, slug, accent_color`,
      [name ?? null, accent_color !== undefined, accentValue, req.labelId]
    );
    await logActivity(req, 'Updated workspace branding', rows[0].name);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update label error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/label/logo — upload/replace the workspace logo (admin only)
router.post('/logo', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ success: false, error: 'Logo must be an image' });
    }

    const { rows: existing } = await pool.query('SELECT logo_r2_key FROM labels WHERE id = $1', [req.labelId]);
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `label-${req.labelId}/branding/logo-${Date.now()}-${safeName}`;
    await uploadFile(key, req.file.buffer, req.file.mimetype);
    if (existing[0]?.logo_r2_key) deleteFile(existing[0].logo_r2_key).catch(() => {});

    await pool.query('UPDATE labels SET logo_r2_key = $1 WHERE id = $2', [key, req.labelId]);
    await logActivity(req, 'Updated workspace logo', null);
    res.json({ success: true, data: { logo_url: await logoUrl(key) } });
  } catch (error) {
    console.error('Logo upload error:', error);
    res.status(500).json({ success: false, error: 'Logo upload failed' });
  }
});

// DELETE /api/label/logo — remove the workspace logo (admin only)
router.delete('/logo', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT logo_r2_key FROM labels WHERE id = $1', [req.labelId]);
    if (rows[0]?.logo_r2_key) deleteFile(rows[0].logo_r2_key).catch(() => {});
    await pool.query('UPDATE labels SET logo_r2_key = NULL WHERE id = $1', [req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Logo delete error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

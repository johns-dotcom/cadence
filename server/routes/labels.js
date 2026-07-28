const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile, isConfigured } = require('../lib/r2');

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
      `SELECT id, name, slug, accent_color, logo_r2_key, logo_data, invoice_settings, vendor_form_token, created_at,
              COALESCE(settings, '{}'::jsonb) AS settings,
              (SELECT COUNT(*) FROM users WHERE label_id = labels.id) AS member_count
       FROM labels WHERE id = $1`,
      [req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const label = rows[0];
    label.logo_url = label.logo_r2_key ? await logoUrl(label.logo_r2_key) : (label.logo_data || null);
    delete label.logo_r2_key;
    delete label.logo_data;
    res.json({ success: true, data: label });
  } catch (error) {
    console.error('Get label error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/label — rename + set accent color (admin only). Slug is immutable.
router.patch('/', requireAdmin, async (req, res) => {
  try {
    const { name, accent_color, invoice_settings, settings } = req.body;

    if (accent_color !== undefined && accent_color !== null && accent_color !== '' && !HEX_RE.test(accent_color)) {
      return res.status(400).json({ success: false, error: 'Accent color must be a hex value like #4F46E5' });
    }
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Name cannot be empty' });
    }
    if (settings !== undefined && (typeof settings !== 'object' || Array.isArray(settings) || settings === null)) {
      return res.status(400).json({ success: false, error: 'Settings must be an object' });
    }

    // Empty string clears the accent (back to Cadence default).
    const accentValue = accent_color === '' ? null : accent_color;

    // settings is shallow-merged (jsonb ||) so each Settings sub-section saves
    // independently without clobbering the others.
    const { rows } = await pool.query(
      `UPDATE labels SET
         name = COALESCE($1, name),
         accent_color = CASE WHEN $2::boolean THEN $3 ELSE accent_color END,
         invoice_settings = CASE WHEN $4::boolean THEN $5::jsonb ELSE invoice_settings END,
         settings = CASE WHEN $6::boolean THEN COALESCE(settings, '{}'::jsonb) || $7::jsonb ELSE settings END
       WHERE id = $8
       RETURNING id, name, slug, accent_color, invoice_settings, COALESCE(settings, '{}'::jsonb) AS settings`,
      [name ?? null, accent_color !== undefined, accentValue,
       invoice_settings !== undefined, invoice_settings ? JSON.stringify(invoice_settings) : null,
       settings !== undefined, settings ? JSON.stringify(settings) : '{}',
       req.labelId]
    );
    await logActivity(req, 'Updated workspace branding', rows[0].name);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update label error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/label/vendor-form-token/rotate — mint a new public vendor-form
// token (admin only). Any previously-shared link stops working immediately.
router.post('/vendor-form-token/rotate', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE labels SET vendor_form_token = md5(random()::text || clock_timestamp()::text || id::text)
         WHERE id = $1 RETURNING vendor_form_token`,
      [req.labelId]
    );
    await logActivity(req, 'Rotated vendor form link', null);
    res.json({ success: true, data: { vendor_form_token: rows[0].vendor_form_token } });
  } catch (error) {
    console.error('Rotate vendor form token error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/label/logo — upload/replace the workspace logo (admin only).
// Uses R2 when configured; otherwise falls back to storing a small logo inline
// as a data: URL so branding works without object storage.
router.post('/logo', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ success: false, error: 'Logo must be an image' });
    }
    const { rows: existing } = await pool.query('SELECT logo_r2_key FROM labels WHERE id = $1', [req.labelId]);
    const oldKey = existing[0]?.logo_r2_key;

    // Preferred path: object storage.
    if (isConfigured()) {
      try {
        const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `label-${req.labelId}/branding/logo-${Date.now()}-${safeName}`;
        await uploadFile(key, req.file.buffer, req.file.mimetype);
        if (oldKey) deleteFile(oldKey).catch(() => {});
        await pool.query('UPDATE labels SET logo_r2_key = $1, logo_data = NULL WHERE id = $2', [key, req.labelId]);
        await logActivity(req, 'Updated workspace logo', null);
        return res.json({ success: true, data: { logo_url: await logoUrl(key) } });
      } catch (e) {
        console.error('R2 logo upload failed, falling back to inline:', e.message);
        // fall through to inline
      }
    }

    // Inline fallback — keep it small (rows + /auth/me payload).
    if (req.file.buffer.length > 512 * 1024) {
      return res.status(400).json({ success: false, error: 'Logo must be under 512 KB (larger files need object storage to be configured).' });
    }
    const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    if (oldKey) deleteFile(oldKey).catch(() => {});
    await pool.query('UPDATE labels SET logo_data = $1, logo_r2_key = NULL WHERE id = $2', [dataUrl, req.labelId]);
    await logActivity(req, 'Updated workspace logo', null);
    res.json({ success: true, data: { logo_url: dataUrl } });
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
    await pool.query('UPDATE labels SET logo_r2_key = NULL, logo_data = NULL WHERE id = $1', [req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Logo delete error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

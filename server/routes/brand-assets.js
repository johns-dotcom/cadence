const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile, isConfigured } = require('../lib/r2');

const router = express.Router();
router.use(authMiddleware, withTenant);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const CATEGORIES = ['Logo', 'Icon', 'Cover art', 'Photo', 'Graphic', 'Other'];
const INLINE_MAX = 2 * 1024 * 1024; // 2 MB cap for the DB data-URL fallback
const canManage = (req) => ['Superadmin', 'Admin', 'Approver'].includes(req.user.role);

async function resolveUrl(a) {
  if (a.r2_key) return await getSignedFileUrl(a.r2_key, 6 * 3600).catch(() => null);
  return a.data || null;
}

// GET /api/brand-assets — the workspace's brand library.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.name, a.category, a.mime_type, a.size_bytes, a.r2_key, a.data, a.uploaded_by, a.created_at,
              u.name AS uploader
         FROM brand_assets a LEFT JOIN users u ON u.id = a.uploaded_by AND u.label_id = a.label_id
        WHERE a.label_id = $1 ORDER BY a.created_at DESC`,
      [req.labelId]
    );
    const data = [];
    for (const a of rows) {
      data.push({
        id: a.id, name: a.name, category: a.category, mime_type: a.mime_type,
        size_bytes: a.size_bytes, uploader: a.uploader, uploaded_by: a.uploaded_by,
        created_at: a.created_at, url: await resolveUrl(a),
      });
    }
    res.json({ success: true, data });
  } catch (error) {
    console.error('List brand assets error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/brand-assets — upload an image (any member).
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ success: false, error: 'Only images can be uploaded' });
    const name = (req.body.name || req.file.originalname || 'Untitled').trim().slice(0, 200);
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Other';
    const size = req.file.buffer.length;

    let r2Key = null, dataUrl = null;
    if (isConfigured()) {
      try {
        const safe = (req.file.originalname || 'asset').replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `label-${req.labelId}/brand/${Date.now()}-${safe}`;
        await uploadFile(key, req.file.buffer, req.file.mimetype);
        r2Key = key;
      } catch (e) { console.error('R2 brand upload failed, falling back to inline:', e.message); }
    }
    if (!r2Key) {
      if (size > INLINE_MAX) return res.status(400).json({ success: false, error: 'Image must be under 2 MB (larger files need object storage to be configured).' });
      dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    const { rows } = await pool.query(
      `INSERT INTO brand_assets (label_id, name, category, mime_type, r2_key, data, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.labelId, name, category, req.file.mimetype, r2Key, dataUrl, size, req.user.id]
    );
    await logActivity(req, 'Uploaded brand asset', name);
    const { rows: fresh } = await pool.query('SELECT * FROM brand_assets WHERE id = $1', [rows[0].id]);
    const a = fresh[0];
    res.status(201).json({ success: true, data: { id: a.id, name: a.name, category: a.category, mime_type: a.mime_type, size_bytes: a.size_bytes, uploader: req.user.name, uploaded_by: a.uploaded_by, created_at: a.created_at, url: await resolveUrl(a) } });
  } catch (error) {
    console.error('Upload brand asset error:', error);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// PATCH /api/brand-assets/:id — rename / recategorize (managers or uploader).
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT uploaded_by FROM brand_assets WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Asset not found' });
    if (!canManage(req) && rows[0].uploaded_by !== req.user.id) return res.status(403).json({ success: false, error: 'Not allowed' });

    const sets = [], vals = [];
    if (typeof req.body.name === 'string' && req.body.name.trim()) { sets.push(`name = $${sets.length + 1}`); vals.push(req.body.name.trim().slice(0, 200)); }
    if (CATEGORIES.includes(req.body.category)) { sets.push(`category = $${sets.length + 1}`); vals.push(req.body.category); }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    vals.push(id, req.labelId);
    await pool.query(`UPDATE brand_assets SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND label_id = $${vals.length}`, vals);
    res.json({ success: true });
  } catch (error) {
    console.error('Update brand asset error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/brand-assets/:id — managers or the uploader.
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT r2_key, uploaded_by FROM brand_assets WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Asset not found' });
    if (!canManage(req) && rows[0].uploaded_by !== req.user.id) return res.status(403).json({ success: false, error: 'Not allowed' });
    if (rows[0].r2_key) deleteFile(rows[0].r2_key).catch(() => {});
    await pool.query('DELETE FROM brand_assets WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete brand asset error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

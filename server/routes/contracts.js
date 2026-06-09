const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile } = require('../lib/r2');

const router = express.Router();
router.use(authMiddleware, withTenant);

// Contracts carry sensitive terms — restrict the whole surface to
// Approver/Admin/Superadmin (mirrors the admin-only contract gate in Boom).
router.use(requireApprover);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const UPDATABLE = [
  'artist_id', 'type', 'status', 'date_signed', 'expiration_date',
  'royalty_split', 'advance', 'territory', 'num_releases', 'notes',
];

// GET /api/contracts — all contracts for the label (with artist name)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name
       FROM contracts c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       WHERE c.label_id = $1
       ORDER BY c.created_at DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List contracts error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/contracts/renewals — active contracts expiring within N days (default 90)
router.get('/renewals', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name
       FROM contracts c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       WHERE c.label_id = $1
         AND c.expiration_date IS NOT NULL
         AND c.status = 'Active'
         AND c.expiration_date <= CURRENT_DATE + ($2 || ' days')::interval
       ORDER BY c.expiration_date ASC`,
      [req.labelId, String(days)]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Renewals error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/contracts/:id — single contract (+ a short-lived signed file URL)
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name
       FROM contracts c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       WHERE c.id = $1 AND c.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Contract not found' });
    const contract = rows[0];
    if (contract.r2_key) {
      try { contract.file_url = await getSignedFileUrl(contract.r2_key, 3600); } catch { contract.file_url = null; }
    }
    res.json({ success: true, data: contract });
  } catch (error) {
    console.error('Get contract error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/contracts
router.post('/', async (req, res) => {
  try {
    const { type } = req.body;
    if (!type || !type.trim()) return res.status(400).json({ success: false, error: 'Contract type is required' });

    if (req.body.artist_id) {
      const { rows: a } = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [req.body.artist_id, req.labelId]);
      if (!a.length) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    }

    const { rows } = await pool.query(
      `INSERT INTO contracts (label_id, artist_id, type, status, date_signed, expiration_date,
        royalty_split, advance, territory, num_releases, notes, created_at, updated_at)
       VALUES ($1,$2,$3,COALESCE($4,'Active'),$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
       RETURNING *`,
      [
        req.labelId, req.body.artist_id || null, type.trim(), req.body.status || null,
        req.body.date_signed || null, req.body.expiration_date || null,
        req.body.royalty_split || null, req.body.advance || null, req.body.territory || null,
        req.body.num_releases || null, req.body.notes || null,
      ]
    );
    await logActivity(req, 'Created contract', `${type} #${rows[0].id}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create contract error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/contracts/:id
router.patch('/:id', async (req, res) => {
  try {
    if (req.body.artist_id) {
      const { rows: a } = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [req.body.artist_id, req.labelId]);
      if (!a.length) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    }
    const keys = Object.keys(req.body).filter(k => UPDATABLE.includes(k));
    if (keys.length === 0) return res.status(400).json({ success: false, error: 'No updatable fields provided' });

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => req.body[k]);
    values.push(parseInt(req.params.id, 10), req.labelId);

    const { rows } = await pool.query(
      `UPDATE contracts SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Contract not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update contract error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/contracts/:id/file — upload/replace the contract document (R2)
router.post('/:id/file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const id = parseInt(req.params.id, 10);

    const { rows: existing } = await pool.query('SELECT r2_key FROM contracts WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Contract not found' });

    // Tenant-namespaced key so one label's objects can't collide with another's.
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `label-${req.labelId}/contracts/${id}-${Date.now()}-${safeName}`;
    await uploadFile(key, req.file.buffer, req.file.mimetype);

    // Best-effort cleanup of the previous file.
    if (existing[0].r2_key) deleteFile(existing[0].r2_key).catch(() => {});

    const { rows } = await pool.query(
      'UPDATE contracts SET file_name = $1, r2_key = $2, updated_at = NOW() WHERE id = $3 AND label_id = $4 RETURNING *',
      [req.file.originalname, key, id, req.labelId]
    );
    await logActivity(req, 'Uploaded contract file', `contract #${id}`);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Contract upload error:', error);
    res.status(500).json({ success: false, error: 'File upload failed' });
  }
});

// DELETE /api/contracts/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT r2_key FROM contracts WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Contract not found' });
    await pool.query('DELETE FROM contracts WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (rows[0].r2_key) deleteFile(rows[0].r2_key).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    console.error('Delete contract error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile } = require('./r2');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * Builds a tenant-scoped CRUD router for a simple document-backed resource
 * (an optional single file in R2 + a row in `table`). Every query is anchored
 * to req.labelId and files are namespaced under `label-<id>/<prefix>/…`, so
 * each workspace's records and documents are fully isolated.
 *
 * @param {object} opts
 * @param {string} opts.table        table name
 * @param {string} opts.prefix       R2 key prefix / activity label
 * @param {string} opts.required     required column on create
 * @param {string[]} opts.fields     columns insertable/updatable
 * @param {string} [opts.orderBy]    ORDER BY clause (default created_at DESC)
 * @param {'approver'|'admin'} [opts.gate]  minimum role (default 'approver')
 */
function fileResourceRouter({ table, prefix, required, fields, orderBy = 'created_at DESC', gate = 'approver' }) {
  const router = express.Router();
  router.use(authMiddleware, withTenant, gate === 'admin' ? requireAdmin : requireApprover);

  // GET / — list
  router.get('/', async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE label_id = $1 ORDER BY ${orderBy}`, [req.labelId]);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error(`List ${table} error:`, error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // GET /:id/file — short-lived signed URL for the attached document
  router.get('/:id/file', async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT r2_key FROM ${table} WHERE id = $1 AND label_id = $2`, [parseInt(req.params.id, 10), req.labelId]);
      if (!rows.length || !rows[0].r2_key) return res.status(404).json({ success: false, error: 'No file' });
      const url = await getSignedFileUrl(rows[0].r2_key, 3600);
      res.json({ success: true, data: { url } });
    } catch (error) {
      console.error(`Get ${table} file error:`, error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // POST / — create
  router.post('/', async (req, res) => {
    try {
      const reqVal = (req.body[required] || '').trim();
      if (!reqVal) return res.status(400).json({ success: false, error: `${required} is required` });
      const cols = fields.filter(f => req.body[f] !== undefined);
      if (!cols.includes(required)) cols.push(required);
      const vals = cols.map(c => (c === required ? reqVal : (req.body[c] === '' ? null : req.body[c] ?? null)));
      const placeholders = cols.map((_, i) => `$${i + 3}`);
      const { rows } = await pool.query(
        `INSERT INTO ${table} (label_id, created_by, ${cols.join(', ')})
         VALUES ($1, $2, ${placeholders.join(', ')}) RETURNING *`,
        [req.labelId, req.user.id, ...vals]
      );
      await logActivity(req, `Added ${prefix}`, reqVal);
      res.status(201).json({ success: true, data: rows[0] });
    } catch (error) {
      console.error(`Create ${table} error:`, error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // PATCH /:id — partial update
  router.patch('/:id', async (req, res) => {
    try {
      const keys = Object.keys(req.body).filter(k => fields.includes(k));
      if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
      const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
      const values = keys.map(k => (req.body[k] === '' ? null : req.body[k]));
      values.push(parseInt(req.params.id, 10), req.labelId);
      const { rows } = await pool.query(
        `UPDATE ${table} SET ${setClauses.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
        values
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error(`Update ${table} error:`, error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // POST /:id/file — upload/replace the document
  router.post('/:id/file', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
      const id = parseInt(req.params.id, 10);
      const { rows: existing } = await pool.query(`SELECT r2_key FROM ${table} WHERE id = $1 AND label_id = $2`, [id, req.labelId]);
      if (!existing.length) return res.status(404).json({ success: false, error: 'Not found' });
      const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `label-${req.labelId}/${prefix}/${id}-${Date.now()}-${safeName}`;
      await uploadFile(key, req.file.buffer, req.file.mimetype);
      if (existing[0].r2_key) deleteFile(existing[0].r2_key).catch(() => {});
      const { rows } = await pool.query(
        `UPDATE ${table} SET file_name = $1, r2_key = $2, updated_at = NOW() WHERE id = $3 AND label_id = $4 RETURNING *`,
        [req.file.originalname, key, id, req.labelId]
      );
      await logActivity(req, `Uploaded ${prefix} file`, `#${id}`);
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error(`${table} upload error:`, error);
      res.status(500).json({ success: false, error: 'File upload failed' });
    }
  });

  // DELETE /:id — remove row + file
  router.delete('/:id', async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT r2_key FROM ${table} WHERE id = $1 AND label_id = $2`, [parseInt(req.params.id, 10), req.labelId]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      await pool.query(`DELETE FROM ${table} WHERE id = $1 AND label_id = $2`, [parseInt(req.params.id, 10), req.labelId]);
      if (rows[0].r2_key) deleteFile(rows[0].r2_key).catch(() => {});
      res.json({ success: true });
    } catch (error) {
      console.error(`Delete ${table} error:`, error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { fileResourceRouter };

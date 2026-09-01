const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile, isConfigured: r2Configured } = require('../lib/r2');
const { blocklistFileFilter } = require('../lib/blockedExtensions');

// Secure company document vault — categorised documents with any number of
// attached files. Formerly a `lib/fileResource` config; it outgrew the factory
// once it needed the Restricted-confidentiality tier and multi-file history,
// neither of which the other file-resources (NDAs) want.
const router = express.Router();

// Admin-gated end to end. Restricted-confidentiality rows narrow further to
// Superadmin, enforced inline per query.
router.use(authMiddleware, withTenant, requireAdmin);

const ENTITY = 'admin_doc';
const MAX_FILE = 25 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE }, fileFilter: blocklistFileFilter });

// multer's fileFilter rejection surfaces as a 500 without this shim.
const uploadGate = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: /not allowed/.test(err.message || '') ? err.message : 'File upload failed' });
    next();
  });

const isSuperadmin = (user) => String(user?.role || '').toLowerCase() === 'superadmin';

// Restricted rows are invisible to non-Superadmin admins. Appended to a WHERE
// that has already anchored label_id — never used on its own.
const restrictedClause = (req, alias = '') => (isSuperadmin(req.user) ? '' : ` AND ${alias}confidentiality IS DISTINCT FROM 'Restricted'`);

const idOf = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

// Tags are a jsonb array. Accept an array from the tag-chip editor, or a
// legacy comma string, and always store an array.
function normalizeTags(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return [];
  const list = Array.isArray(value)
    ? value
    : String(value).split(',');
  return list.map(t => String(t).trim()).filter(Boolean).slice(0, 40);
}

const WRITABLE = ['title', 'category', 'status', 'confidentiality', 'counterparty', 'signed_date', 'expiration_date', 'notes'];

// Load a row for a guard check. Returns null when it doesn't exist in-tenant.
async function loadRow(id, labelId) {
  const { rows } = await pool.query('SELECT id, title, confidentiality FROM admin_docs WHERE id = $1 AND label_id = $2', [id, labelId]);
  return rows[0] || null;
}

// A non-Superadmin may not read, edit or delete a Restricted row, nor mark one
// Restricted. Returns an error string, or null when the write may proceed.
function restrictedBlock(req, existing, nextConfidentiality) {
  if (isSuperadmin(req.user)) return null;
  if (existing && existing.confidentiality === 'Restricted') return 'Restricted — Superadmin required';
  if (nextConfidentiality === 'Restricted') return 'Only a Superadmin can mark a document Restricted';
  return null;
}

// ── List ────────────────────────────────────────────────────────────────
// updated_at DESC: a file upload bumps it, so a document that was just worked
// on floats to the top.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, u.name AS created_by_name,
              (SELECT COUNT(*)::int FROM entity_files ef
                WHERE ef.label_id = d.label_id AND ef.entity_type = '${ENTITY}' AND ef.entity_id = d.id) AS file_count
         FROM admin_docs d
         LEFT JOIN users u ON u.id = d.created_by
        WHERE d.label_id = $1${restrictedClause(req, 'd.')}
        ORDER BY d.updated_at DESC NULLS LAST, d.id DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List admin_docs error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Expiring (60-day window) ────────────────────────────────────────────
// Archived and already-Expired documents are excluded — re-flagging a document
// somebody has already dealt with is what makes a banner get ignored. days_left
// is computed in SQL against CURRENT_DATE so it can't disagree by a timezone.
router.get('/expiring', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, category, counterparty, expiration_date,
              (expiration_date - CURRENT_DATE)::int AS days_left
         FROM admin_docs
        WHERE label_id = $1
          AND expiration_date IS NOT NULL
          AND expiration_date > CURRENT_DATE
          AND expiration_date <= CURRENT_DATE + INTERVAL '60 days'
          AND (status IS NULL OR status NOT IN ('Archived', 'Expired'))
          ${restrictedClause(req)}
        ORDER BY expiration_date ASC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Expiring admin_docs error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Single document ─────────────────────────────────────────────────────
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, u.name AS created_by_name
         FROM admin_docs d LEFT JOIN users u ON u.id = d.created_by
        WHERE d.id = $1 AND d.label_id = $2${restrictedClause(req, 'd.')}`,
      [idOf(req.params.id), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get admin_doc error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Create ──────────────────────────────────────────────────────────────
// Only `title` is required server-side: quick-upload creates a bare row titled
// from the filename and the category is filled in afterwards.
router.post('/', async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: 'Title is required' });
    const block = restrictedBlock(req, null, req.body?.confidentiality);
    if (block) return res.status(403).json({ success: false, error: block });

    const tags = normalizeTags(req.body?.tags) ?? [];
    const { rows } = await pool.query(
      `INSERT INTO admin_docs
         (label_id, created_by, title, category, status, confidentiality, counterparty,
          signed_date, expiration_date, tags, notes, is_template)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'Active'), COALESCE($6, 'Internal'), $7,
               $8, $9, $10::jsonb, $11, COALESCE($12, FALSE))
       RETURNING *`,
      [
        req.labelId, req.user.id, title,
        req.body?.category || null,
        req.body?.status || null,
        req.body?.confidentiality || null,
        req.body?.counterparty || null,
        req.body?.signed_date || null,
        req.body?.expiration_date || null,
        JSON.stringify(tags),
        req.body?.notes || null,
        typeof req.body?.is_template === 'boolean' ? req.body.is_template : null,
      ]
    );
    await logActivity(req, 'Added admin document', title);
    res.status(201).json({ success: true, data: { ...rows[0], file_count: 0 } });
  } catch (error) {
    console.error('Create admin_doc error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Partial update ──────────────────────────────────────────────────────
router.patch('/:id(\\d+)', async (req, res) => {
  try {
    const id = idOf(req.params.id);
    const existing = await loadRow(id, req.labelId);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });
    const block = restrictedBlock(req, existing, req.body?.confidentiality);
    if (block) return res.status(403).json({ success: false, error: block });

    const sets = [];
    const values = [];
    for (const k of WRITABLE) {
      if (req.body[k] === undefined) continue;
      if (k === 'title' && !String(req.body[k] || '').trim()) {
        return res.status(400).json({ success: false, error: 'Title is required' });
      }
      values.push(req.body[k] === '' ? null : req.body[k]);
      sets.push(`${k} = $${values.length}`);
    }
    const tags = normalizeTags(req.body?.tags);
    if (tags !== undefined) { values.push(JSON.stringify(tags)); sets.push(`tags = $${values.length}::jsonb`); }
    if (typeof req.body?.is_template === 'boolean') { values.push(req.body.is_template); sets.push(`is_template = $${values.length}`); }
    if (!sets.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });

    values.push(id, req.labelId);
    const { rows } = await pool.query(
      `UPDATE admin_docs SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update admin_doc error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Delete (row + every attached file) ──────────────────────────────────
router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const id = idOf(req.params.id);
    const existing = await loadRow(id, req.labelId);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });
    const block = restrictedBlock(req, existing, undefined);
    if (block) return res.status(403).json({ success: false, error: block });

    const { rows: files } = await pool.query(
      `DELETE FROM entity_files WHERE label_id = $1 AND entity_type = '${ENTITY}' AND entity_id = $2 RETURNING r2_key`,
      [req.labelId, id]
    );
    const { rows: doc } = await pool.query('DELETE FROM admin_docs WHERE id = $1 AND label_id = $2 RETURNING r2_key', [id, req.labelId]);
    for (const key of [...files.map(f => f.r2_key), doc[0]?.r2_key]) {
      if (key) deleteFile(key).catch(() => {});
    }
    await logActivity(req, 'Deleted admin document', existing.title);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete admin_doc error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Attachments (entity_files — every upload is kept) ───────────────────

// Shared owner check so a Restricted document's files are as protected as its
// metadata. Returns the row or null.
async function ownedDoc(req, id) {
  const row = await loadRow(id, req.labelId);
  if (!row) return null;
  if (!isSuperadmin(req.user) && row.confidentiality === 'Restricted') return null;
  return row;
}

router.get('/:id(\\d+)/files', async (req, res) => {
  try {
    const id = idOf(req.params.id);
    if (!await ownedDoc(req, id)) return res.status(404).json({ success: false, error: 'Not found' });
    const { rows } = await pool.query(
      `SELECT ef.id, ef.original_name, ef.mime_type, ef.file_size, ef.created_at,
              u.name AS uploaded_by_name
         FROM entity_files ef LEFT JOIN users u ON u.id = ef.uploaded_by
        WHERE ef.label_id = $1 AND ef.entity_type = '${ENTITY}' AND ef.entity_id = $2
        ORDER BY ef.created_at DESC, ef.id DESC`,
      [req.labelId, id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List admin_doc files error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Upload ADDS a revision — it never replaces, so filing an amendment can't
// destroy the original.
router.post('/:id(\\d+)/files', uploadGate, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const id = idOf(req.params.id);
    if (!await ownedDoc(req, id)) return res.status(404).json({ success: false, error: 'Not found' });
    // Say so plainly rather than letting the S3 client fail with a generic
    // upload error — the document metadata still saved, only the file didn't.
    if (!r2Configured()) return res.status(503).json({ success: false, error: 'File storage is not configured on this deployment.' });

    const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `label-${req.labelId}/admin-docs/${id}-${Date.now()}-${safe}`;
    await uploadFile(key, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO entity_files (label_id, entity_type, entity_id, filename, original_name, mime_type, r2_key, file_size, uploaded_by)
       VALUES ($1, '${ENTITY}', $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, original_name, mime_type, file_size, created_at`,
      [req.labelId, id, key, req.file.originalname, req.file.mimetype, key, req.file.size, req.user?.id || null]
    );
    // Bump the parent so a touched document sorts to the top of the list.
    await pool.query('UPDATE admin_docs SET updated_at = NOW() WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    await logActivity(req, 'Uploaded admin document file', `#${id}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Admin doc upload error:', error);
    res.status(500).json({ success: false, error: 'File upload failed' });
  }
});

router.get('/:id(\\d+)/files/:fileId(\\d+)', async (req, res) => {
  try {
    const id = idOf(req.params.id);
    if (!await ownedDoc(req, id)) return res.status(404).json({ success: false, error: 'Not found' });
    const { rows } = await pool.query(
      `SELECT r2_key FROM entity_files
        WHERE id = $1 AND label_id = $2 AND entity_type = '${ENTITY}' AND entity_id = $3`,
      [idOf(req.params.fileId), req.labelId, id]
    );
    if (!rows.length || !rows[0].r2_key) return res.status(404).json({ success: false, error: 'File not found' });
    if (!r2Configured()) return res.status(503).json({ success: false, error: 'File storage is not configured on this deployment.' });
    const url = await getSignedFileUrl(rows[0].r2_key, 3600);
    res.json({ success: true, data: { url } });
  } catch (error) {
    console.error('Admin doc file url error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/:id(\\d+)/files/:fileId(\\d+)', async (req, res) => {
  try {
    const id = idOf(req.params.id);
    if (!await ownedDoc(req, id)) return res.status(404).json({ success: false, error: 'Not found' });
    const { rows } = await pool.query(
      `DELETE FROM entity_files
        WHERE id = $1 AND label_id = $2 AND entity_type = '${ENTITY}' AND entity_id = $3
        RETURNING r2_key`,
      [idOf(req.params.fileId), req.labelId, id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'File not found' });
    if (rows[0].r2_key) deleteFile(rows[0].r2_key).catch(() => {});
    await pool.query('UPDATE admin_docs SET updated_at = NOW() WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete admin_doc file error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

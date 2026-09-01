const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, deleteFile, isConfigured } = require('../lib/r2');

const router = express.Router();
// Legal documents — Approver+ only. Everything scoped to req.labelId.
router.use(authMiddleware, withTenant, requireApprover);

const FIELDS = [
  'effective_date', 'artist_name', 'releasing_label', 'other_label_artist',
  'song_title', 'release_date', 'release_format', 'royalty_percent',
  'contact_email', 'signatory_name', 'signatory_title', 'custom_body',
];

// The client renders the waiver PDF with jsPDF and posts it alongside the form
// values, so the issued document lands on the artist's Documents tab without a
// second round-trip. PDF only — same gate the contracts uploader uses.
const pdfOnly = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') cb(null, true);
  else cb(new Error('Only PDF files are allowed'), false);
};
const upload = multer({ storage: multer.memoryStorage(), fileFilter: pdfOnly, limits: { fileSize: 10 * 1024 * 1024 } });
// Multer's fileFilter error surfaces as a 500 without this shim.
const pdfGate = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err) return res.status(400).json({ success: false, error: err.message === 'Only PDF files are allowed' ? err.message : 'File upload failed' });
  next();
});

// royalty_percent is NUMERIC in the schema but a free-text input on the form
// ("25", "25%", "e.g. 25"), because the waiver body renders it verbatim into a
// sentence. Pull the first number out; anything unparseable becomes NULL, which
// the body renders as the "X%" placeholder.
function coerce(col, v) {
  if (v === '' || v === null || v === undefined) return null;
  if (col === 'royalty_percent') {
    const m = String(v).match(/-?\d+(\.\d+)?/);
    return m ? m[0] : null;
  }
  return v;
}

// Parse the multipart `payload` JSON field. Falls back to req.body for a
// plain-JSON call (a waiver saved without a rendered PDF still works).
function parsePayload(req) {
  if (req.body && typeof req.body.payload === 'string') {
    try { return JSON.parse(req.body.payload); } catch { return {}; }
  }
  return req.body || {};
}

// Resolve the waiver's artist to a roster row. Case-insensitive but EXACT —
// fuzzy matching here would risk filing a waiver on the wrong artist's
// Documents tab, which is worse than not filing it at all. Label-scoped.
async function lookupArtistId(name, labelId) {
  if (!name) return null;
  const { rows } = await pool.query(
    'SELECT id FROM artists WHERE label_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
    [labelId, String(name).trim()]
  );
  return rows.length ? rows[0].id : null;
}

// Drop an entity_files row + its R2 object. Best-effort: a storage hiccup must
// not fail the waiver write.
async function dropFile(fileId, labelId) {
  if (!fileId) return;
  try {
    const { rows } = await pool.query('SELECT r2_key FROM entity_files WHERE id = $1 AND label_id = $2', [fileId, labelId]);
    await pool.query('DELETE FROM entity_files WHERE id = $1 AND label_id = $2', [fileId, labelId]);
    if (rows.length && rows[0].r2_key && isConfigured()) await deleteFile(rows[0].r2_key);
  } catch (e) { console.warn('label-waiver: file cleanup failed:', e.message); }
}

// Store the generated PDF on the artist's Documents tab. When a prior file id
// is supplied it is replaced IN PLACE (old object deleted, row updated) so the
// tab doesn't accumulate stale copies of the same waiver. Returns the
// entity_files row id, or null when there is nothing to attach.
async function attachPdfToArtist({ artistId, labelId, buffer, filename, existingFileId, userId }) {
  if (!artistId || !buffer) return existingFileId || null;
  // R2 unconfigured (local dev) — save the waiver, skip the attachment rather
  // than 500-ing the whole request.
  if (!isConfigured()) return existingFileId || null;
  const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `label-${labelId}/artist/${artistId}-${Date.now()}-${safe}`;
  await uploadFile(key, buffer, 'application/pdf');

  if (existingFileId) {
    const { rows } = await pool.query('SELECT r2_key FROM entity_files WHERE id = $1 AND label_id = $2', [existingFileId, labelId]);
    if (rows.length) {
      if (rows[0].r2_key) { try { await deleteFile(rows[0].r2_key); } catch (e) { console.warn('label-waiver: prior R2 delete failed:', e.message); } }
      await pool.query(
        `UPDATE entity_files SET filename = $1, original_name = $2, file_size = $3, r2_key = $4, mime_type = 'application/pdf'
          WHERE id = $5 AND label_id = $6`,
        [key, filename, buffer.length, key, existingFileId, labelId]
      );
      return existingFileId;
    }
  }
  const ins = await pool.query(
    `INSERT INTO entity_files (label_id, entity_type, entity_id, filename, original_name, mime_type, r2_key, file_size, uploaded_by)
     VALUES ($1, 'artist', $2, $3, $4, 'application/pdf', $5, $6, $7) RETURNING id`,
    [labelId, artistId, key, filename, key, buffer.length, userId || null]
  );
  return ins.rows[0].id;
}

// GET /api/label-waivers — all waivers for this workspace.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, u.name AS created_by_name
         FROM label_waivers w
         LEFT JOIN users u ON u.id = w.created_by AND u.label_id = w.label_id
        WHERE w.label_id = $1 ORDER BY w.created_at DESC, w.id DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List label waivers error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/label-waivers — create. Multipart: `file` is the rendered PDF,
// `payload` the JSON form values (plain JSON also accepted).
router.post('/', pdfGate, async (req, res) => {
  try {
    const body = parsePayload(req);
    for (const k of ['effective_date', 'artist_name', 'releasing_label', 'song_title']) {
      if (!body[k] || !String(body[k]).trim()) {
        return res.status(400).json({ success: false, error: `${k.replace(/_/g, ' ')} is required` });
      }
    }
    const artistId = await lookupArtistId(body.artist_name, req.labelId);
    let fileId = null;
    if (artistId && req.file) {
      fileId = await attachPdfToArtist({
        artistId, labelId: req.labelId, buffer: req.file.buffer,
        filename: req.file.originalname || 'label-waiver.pdf', existingFileId: null, userId: req.user.id,
      });
    }

    const cols = FIELDS.filter(f => body[f] !== undefined);
    const vals = cols.map(c => coerce(c, body[c]));
    const placeholders = cols.map((_, i) => `$${i + 5}`);
    const { rows } = await pool.query(
      `INSERT INTO label_waivers (label_id, created_by, artist_id, file_id, ${cols.join(', ')})
       VALUES ($1, $2, $3, $4, ${placeholders.join(', ')}) RETURNING *`,
      [req.labelId, req.user.id, artistId, fileId, ...vals]
    );
    await logActivity(req, 'Created label waiver', `${body.artist_name} — ${body.song_title}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create label waiver error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/label-waivers/:id — update. Re-resolves artist_id from the
// (possibly changed) artist_name; a new PDF replaces the attachment in place,
// and an artist change migrates or drops the old artist's copy.
router.put('/:id', pdfGate, async (req, res) => {
  try {
    const body = parsePayload(req);
    const keys = Object.keys(body).filter(k => FIELDS.includes(k));
    if (!keys.length && !req.file) return res.status(400).json({ success: false, error: 'No updatable fields provided' });

    const id = parseInt(req.params.id, 10);
    const prior = await pool.query('SELECT artist_id, file_id FROM label_waivers WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!prior.rows.length) return res.status(404).json({ success: false, error: 'Waiver not found' });

    let artistId = prior.rows[0].artist_id;
    if (Object.prototype.hasOwnProperty.call(body, 'artist_name')) {
      artistId = await lookupArtistId(body.artist_name, req.labelId);
    }

    let fileId = prior.rows[0].file_id;
    if (req.file) {
      // The waiver moved to a different artist — the old artist's Documents
      // tab must not keep claiming it.
      if (artistId !== prior.rows[0].artist_id && fileId) { await dropFile(fileId, req.labelId); fileId = null; }
      if (artistId) {
        fileId = await attachPdfToArtist({
          artistId, labelId: req.labelId, buffer: req.file.buffer,
          filename: req.file.originalname || 'label-waiver.pdf', existingFileId: fileId, userId: req.user.id,
        });
      } else {
        // No roster match to attach to — don't leave an orphan on whoever
        // owned the previous copy.
        await dropFile(fileId, req.labelId);
        fileId = null;
      }
    } else if (artistId !== prior.rows[0].artist_id && fileId) {
      await dropFile(fileId, req.labelId);
      fileId = null;
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => coerce(k, body[k]));
    setClauses.push(`artist_id = $${values.length + 1}`); values.push(artistId);
    setClauses.push(`file_id = $${values.length + 1}`); values.push(fileId);
    values.push(id, req.labelId);
    const { rows } = await pool.query(
      `UPDATE label_waivers SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Waiver not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update label waiver error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/label-waivers/:id — also cleans up the attached Documents-tab file.
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT file_id FROM label_waivers WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Waiver not found' });
    await dropFile(rows[0].file_id, req.labelId);
    await pool.query('DELETE FROM label_waivers WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete label waiver error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

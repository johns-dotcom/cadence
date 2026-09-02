const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const activityBot = require('../lib/activityBot');
const { uploadFile, getSignedFileUrl, deleteFile, isConfigured: r2Configured } = require('../lib/r2');
const { DEAL_STAGES, DEAL_TYPES, PRIORITIES } = require('../lib/constants');

const router = express.Router();
router.use(authMiddleware, withTenant);

// Deal documents: term sheets, demos, one-pagers. Same 10MB + allow-list the
// roster's Documents panel uses — an attachment surface with no MIME gate is
// how a workspace ends up hosting somebody's executable.
const FILE_OK = /^(image\/|application\/pdf$|audio\/|video\/|text\/plain$|application\/(msword|vnd\.openxmlformats|vnd\.ms-|zip|x-zip))/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (FILE_OK.test(file.mimetype || '')) return cb(null, true);
    cb(new Error('Unsupported file type'));
  },
});

// multer rejects (bad MIME, oversize) surface as thrown middleware errors, which
// Express answers with a 500 HTML page — the client's `err.response.data.error`
// reads undefined and the user is told "Upload failed" with no reason. Convert
// them to the JSON 400 the rest of the API speaks.
const uploadOne = (field) => (req, res, next) => upload.single(field)(req, res, (err) => {
  if (!err) return next();
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 10MB'
    : err.message === 'Unsupported file type' ? 'Unsupported file type'
      : 'Upload failed';
  res.status(400).json({ success: false, error: msg });
});

const UPDATABLE = [
  'artist_name', 'genre', 'stage', 'ar_rep', 'source', 'deal_type',
  'offer_amount', 'spotify_monthly_listeners', 'last_contact_date',
  'next_followup_date', 'priority', 'notes', 'contact', 'links',
];

// Closed vocabularies are enforced HERE, not just in the <select>. A dropdown is
// a convenience; the column is the contract. Without this an API client (or a
// stale bundle carrying the old release-type list) silently writes a stage no
// column on the board will ever render, and the card disappears.
//   * `undefined` = field absent from the PATCH → untouched.
//   * `null`/`''`  = an intentional clear → allowed for the optional fields.
function validateVocab(body) {
  const check = (key, list, { clearable }) => {
    const v = body[key];
    if (v === undefined) return null;
    if (v === null || v === '') return clearable ? null : `${key} cannot be empty`;
    if (!list.includes(v)) return `Invalid ${key}: ${String(v).slice(0, 40)}`;
    return null;
  };
  return check('stage', DEAL_STAGES, { clearable: false })
    || check('priority', PRIORITIES, { clearable: true })
    || check('deal_type', DEAL_TYPES, { clearable: true });
}

// A cleared money field is null; a deliberate 0 is ZERO. `x || null` collapses
// the two and silently deletes a $0 offer (which is a real, meaningful term).
const numOrNull = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

const dealId = (req) => {
  const id = parseInt(req.params.id, 10);
  return Number.isFinite(id) ? id : null;
};

// GET /api/deals — full pipeline for the label.
// Ordered by added_date, NOT updated_at: an `updated_at DESC` board reshuffles
// every card the moment anyone edits one, so the pile you were reading moves
// under the cursor.
router.get('/', async (req, res) => {
  try {
    const params = [req.labelId];
    let where = 'label_id = $1';
    if (req.query.stage) {
      params.push(req.query.stage);
      where += ` AND stage = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT * FROM deals WHERE ${where} ORDER BY added_date DESC NULLS LAST, id DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List deals error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/deals
router.post('/', async (req, res) => {
  try {
    const { artist_name } = req.body;
    if (!artist_name || !artist_name.trim()) {
      return res.status(400).json({ success: false, error: 'Artist name is required' });
    }
    const bad = validateVocab(req.body);
    if (bad) return res.status(400).json({ success: false, error: bad });

    const { rows } = await pool.query(
      `INSERT INTO deals (label_id, artist_name, genre, stage, ar_rep, source, deal_type,
        offer_amount, spotify_monthly_listeners, last_contact_date, next_followup_date, priority, notes, contact, links,
        added_date, created_at, updated_at)
       VALUES ($1,$2,$3,COALESCE($4,'Scouting'),$5,$6,$7,$8,$9,$10,$11,COALESCE($12,'Medium'),$13,$14,$15,CURRENT_DATE,NOW(),NOW())
       RETURNING *`,
      [
        req.labelId, artist_name.trim(), req.body.genre || null, req.body.stage || null,
        req.body.ar_rep || null, req.body.source || null, req.body.deal_type || null,
        numOrNull(req.body.offer_amount), numOrNull(req.body.spotify_monthly_listeners),
        req.body.last_contact_date || null, req.body.next_followup_date || null,
        req.body.priority || null, req.body.notes || null, req.body.contact || null, req.body.links || null,
      ]
    );
    await logActivity(req, 'Added deal', artist_name.trim());
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create deal error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/deals/:id — partial update (used for stage changes + edits)
router.patch('/:id(\\d+)', async (req, res) => {
  try {
    const id = dealId(req);
    if (id === null) return res.status(400).json({ success: false, error: 'Bad id' });
    const keys = Object.keys(req.body).filter(k => UPDATABLE.includes(k));
    if (keys.length === 0) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    const bad = validateVocab(req.body);
    if (bad) return res.status(400).json({ success: false, error: bad });

    // Note the prior stage so we only announce genuine stage moves.
    let oldStage = null;
    if (keys.includes('stage')) {
      const cur = await pool.query('SELECT stage FROM deals WHERE id = $1 AND label_id = $2', [id, req.labelId]);
      oldStage = cur.rows[0]?.stage;
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => (
      k === 'offer_amount' || k === 'spotify_monthly_listeners' ? numOrNull(req.body[k]) : req.body[k]
    ));
    values.push(id, req.labelId);

    const { rows } = await pool.query(
      `UPDATE deals SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Deal not found' });
    if (keys.includes('stage') && rows[0].stage && rows[0].stage !== oldStage) {
      const signed = /sign|closed|won/i.test(rows[0].stage);
      activityBot.postEvent(req.labelId, {
        text: `${signed ? '🎉' : '🤝'} Deal *${rows[0].artist_name}* moved to *${rows[0].stage}*`,
        icon: 'handshake', link: '/deals',
      });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update deal error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/deals/:id — cleans up the deal's attachments too, or the R2
// objects outlive every row that knows their keys.
router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const id = dealId(req);
    if (id === null) return res.status(400).json({ success: false, error: 'Bad id' });
    const { rows: files } = await pool.query(
      "SELECT r2_key FROM entity_files WHERE label_id = $1 AND entity_type = 'deal' AND entity_id = $2",
      [req.labelId, id]
    );
    const { rowCount } = await pool.query('DELETE FROM deals WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Deal not found' });
    await pool.query("DELETE FROM entity_files WHERE label_id = $1 AND entity_type = 'deal' AND entity_id = $2", [req.labelId, id]);
    for (const f of files) if (f.r2_key) deleteFile(f.r2_key).catch(() => {});
    res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('Delete deal error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Deal document attachments (via entity_files) ─────────────────────────
// Term sheets and demos live with the deal, not in someone's inbox. Same
// entity_files store + R2 key shape the roster uses.

const dealInLabel = async (id, labelId) => {
  const { rows } = await pool.query('SELECT 1 FROM deals WHERE id = $1 AND label_id = $2', [id, labelId]);
  return rows.length > 0;
};

// GET /api/deals/:id/files
router.get('/:id(\\d+)/files', async (req, res) => {
  try {
    const id = dealId(req);
    if (id === null) return res.status(400).json({ success: false, error: 'Bad id' });
    const { rows } = await pool.query(
      `SELECT f.id, f.original_name, f.mime_type, f.file_size, f.created_at,
              f.uploaded_by, u.name AS uploaded_by_name
         FROM entity_files f
         LEFT JOIN users u ON u.id = f.uploaded_by AND u.label_id = f.label_id
        WHERE f.label_id = $1 AND f.entity_type = 'deal' AND f.entity_id = $2
        ORDER BY f.created_at DESC`,
      [req.labelId, id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List deal files error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/deals/:id/files
router.post('/:id(\\d+)/files', uploadOne('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const id = dealId(req);
    if (id === null) return res.status(400).json({ success: false, error: 'Bad id' });
    if (!(await dealInLabel(id, req.labelId))) return res.status(404).json({ success: false, error: 'Deal not found' });
    const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `label-${req.labelId}/deal/${id}-${Date.now()}-${safe}`;
    await uploadFile(key, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO entity_files (label_id, entity_type, entity_id, filename, original_name, mime_type, r2_key, file_size, uploaded_by)
       VALUES ($1, 'deal', $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, original_name, mime_type, file_size, created_at, uploaded_by`,
      [req.labelId, id, key, req.file.originalname, req.file.mimetype, key, req.file.size, req.user.id]
    );
    res.status(201).json({ success: true, data: { ...rows[0], uploaded_by_name: req.user.name } });
  } catch (error) {
    if (error.message === 'Unsupported file type') {
      return res.status(400).json({ success: false, error: 'Unsupported file type' });
    }
    console.error('Deal file upload error:', error);
    res.status(500).json({ success: false, error: 'File upload failed' });
  }
});

// GET /api/deals/:id/files/:fileId — signed URL.
router.get('/:id(\\d+)/files/:fileId(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r2_key FROM entity_files WHERE id = $1 AND label_id = $2 AND entity_type = 'deal' AND entity_id = $3`,
      [parseInt(req.params.fileId, 10), req.labelId, dealId(req)]
    );
    if (!rows.length || !rows[0].r2_key) return res.status(404).json({ success: false, error: 'File not found' });
    if (!r2Configured()) return res.status(503).json({ success: false, error: "File storage is not configured on this deployment." });
    const url = await getSignedFileUrl(rows[0].r2_key, 3600);
    res.json({ success: true, data: { url } });
  } catch (error) {
    console.error('Deal file url error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/deals/:id/files/:fileId
router.delete('/:id(\\d+)/files/:fileId(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r2_key FROM entity_files WHERE id = $1 AND label_id = $2 AND entity_type = 'deal' AND entity_id = $3`,
      [parseInt(req.params.fileId, 10), req.labelId, dealId(req)]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'File not found' });
    await pool.query('DELETE FROM entity_files WHERE id = $1 AND label_id = $2', [parseInt(req.params.fileId, 10), req.labelId]);
    if (rows[0].r2_key) deleteFile(rows[0].r2_key).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    console.error('Delete deal file error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

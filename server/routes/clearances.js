const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { buildClearanceXlsx } = require('../lib/clearanceXlsx');
const { uploadFile, deleteFile, isConfigured } = require('../lib/r2');

const router = express.Router();
// Clearances carry contractual/royalty detail — Approver+ only, label-scoped.
router.use(authMiddleware, withTenant, requireApprover);

const FIELDS = ['artist_id', 'title', 'project_number', 'product_commitment', 'contractual_members', 'effective_date', 'royalty_rate', 'royalty_account', 'tracks'];

// Validate a client-supplied artist_id belongs to this workspace.
async function checkArtist(artistId, labelId) {
  if (!artistId) return true;
  const { rows } = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [artistId, labelId]);
  return rows.length > 0;
}

async function artistName(artistId, labelId) {
  if (!artistId) return null;
  const { rows } = await pool.query('SELECT name FROM artists WHERE id = $1 AND label_id = $2', [artistId, labelId]);
  return rows.length ? rows[0].name : null;
}

// Filename for the generated chart. Shared by the Documents-tab copy and the
// direct download so both read the same.
function chartFilename(name, title) {
  const slug = (s) => String(s || '').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'untitled';
  return `Clearance-${slug(name)}${title ? '-' + slug(title) : ''}-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

// Drop an entity_files row + its R2 object. Best-effort — a storage hiccup
// must not fail the clearance write.
async function dropFile(fileId, labelId) {
  if (!fileId) return;
  try {
    const { rows } = await pool.query('SELECT r2_key FROM entity_files WHERE id = $1 AND label_id = $2', [fileId, labelId]);
    await pool.query('DELETE FROM entity_files WHERE id = $1 AND label_id = $2', [fileId, labelId]);
    if (rows.length && rows[0].r2_key && isConfigured()) await deleteFile(rows[0].r2_key);
  } catch (e) { console.warn('clearance: file cleanup failed:', e.message); }
}

// Generate the XLSX and file it on the artist's Documents tab, replacing the
// previous copy in place when there is one. Returns the entity_files row id.
// Degrades to a no-op (returning whatever file id already existed) when R2 is
// unconfigured, so local dev and a mis-provisioned deploy still save the row.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function generateAndAttach({ clearance, artistId, name, labelId, existingFileId, userId }) {
  if (!artistId) return null;
  if (!isConfigured()) return existingFileId || null;
  try {
    const buf = Buffer.from(await buildClearanceXlsx(clearance, name));
    const original = chartFilename(name, clearance.title);
    const key = `label-${labelId}/artist/${artistId}-${Date.now()}-${original.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await uploadFile(key, buf, XLSX_MIME);

    if (existingFileId) {
      const { rows } = await pool.query('SELECT r2_key FROM entity_files WHERE id = $1 AND label_id = $2', [existingFileId, labelId]);
      if (rows.length) {
        if (rows[0].r2_key) { try { await deleteFile(rows[0].r2_key); } catch (e) { console.warn('clearance: prior R2 delete failed:', e.message); } }
        await pool.query(
          `UPDATE entity_files SET filename = $1, original_name = $2, file_size = $3, r2_key = $4, mime_type = $5
            WHERE id = $6 AND label_id = $7`,
          [key, original, buf.length, key, XLSX_MIME, existingFileId, labelId]
        );
        return existingFileId;
      }
    }
    const ins = await pool.query(
      `INSERT INTO entity_files (label_id, entity_type, entity_id, filename, original_name, mime_type, r2_key, file_size, uploaded_by)
       VALUES ($1, 'artist', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [labelId, artistId, key, original, XLSX_MIME, key, buf.length, userId || null]
    );
    return ins.rows[0].id;
  } catch (e) {
    // The chart is a convenience copy; never fail the save over it.
    console.warn('clearance: chart attach failed:', e.message);
    return existingFileId || null;
  }
}

// GET /api/clearances/catalog?artist_id= — releases for autofilling track rows.
// 400 (not an empty list) without an artist: a silent [] reads as "this artist
// has no catalog", which is a different and misleading answer.
router.get('/catalog', async (req, res) => {
  try {
    const artistId = req.query.artist_id ? parseInt(req.query.artist_id, 10) : null;
    if (!artistId || Number.isNaN(artistId)) return res.status(400).json({ success: false, error: 'artist_id is required' });
    const { rows } = await pool.query(
      `SELECT id, project_name, release_date, isrc, producer, featured_artists, release_type, genre
         FROM releases
        WHERE label_id = $1 AND artist_id = $2 AND (archived = FALSE OR archived IS NULL)
        ORDER BY release_date DESC NULLS LAST, project_name ASC`,
      [req.labelId, artistId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Clearance catalog error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/clearances — list (with artist name + track count).
// Ordered by CREATION, not update: an ordering that reshuffles the list every
// time someone opens and saves a row makes it impossible to find anything.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name, ef.original_name AS file_filename,
              COALESCE(jsonb_array_length(c.tracks), 0) AS track_count
       FROM clearances c
       LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       LEFT JOIN entity_files ef ON ef.id = c.file_id AND ef.label_id = c.label_id
       WHERE c.label_id = $1 ORDER BY c.created_at DESC, c.id DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List clearances error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/clearances/:id
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name FROM clearances c
       LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       WHERE c.id = $1 AND c.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Clearance not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get clearance error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/clearances
router.post('/', async (req, res) => {
  try {
    const artistId = req.body.artist_id ? parseInt(req.body.artist_id, 10) : null;
    if (!(await checkArtist(artistId, req.labelId))) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    const tracks = Array.isArray(req.body.tracks) ? JSON.stringify(req.body.tracks) : '[]';
    const { rows } = await pool.query(
      `INSERT INTO clearances (label_id, artist_id, title, project_number, product_commitment, contractual_members, effective_date, royalty_rate, royalty_account, tracks, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
      [req.labelId, artistId, req.body.title || null, req.body.project_number || null, req.body.product_commitment || null,
       req.body.contractual_members || null, req.body.effective_date || null, req.body.royalty_rate || null, req.body.royalty_account || null, tracks, req.user.id]
    );
    const row = rows[0];
    const fileId = await generateAndAttach({
      clearance: row, artistId, name: await artistName(artistId, req.labelId),
      labelId: req.labelId, existingFileId: null, userId: req.user.id,
    });
    if (fileId) await pool.query('UPDATE clearances SET file_id = $1 WHERE id = $2 AND label_id = $3', [fileId, row.id, req.labelId]);
    await logActivity(req, 'Created clearance', req.body.title || `#${row.id}`);
    res.status(201).json({ success: true, data: { ...row, file_id: fileId } });
  } catch (error) {
    console.error('Create clearance error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/clearances/:id — partial patch. The filed chart is regenerated from
// the POST-UPDATE row, and migrated to the new artist when the artist changes.
router.put('/:id(\\d+)', async (req, res) => {
  try {
    if (req.body.artist_id && !(await checkArtist(parseInt(req.body.artist_id, 10), req.labelId))) {
      return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    }
    const id = parseInt(req.params.id, 10);
    const prior = await pool.query('SELECT artist_id, file_id FROM clearances WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!prior.rows.length) return res.status(404).json({ success: false, error: 'Clearance not found' });

    const keys = Object.keys(req.body).filter(k => FIELDS.includes(k));
    if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}${k === 'tracks' ? '::jsonb' : ''}`);
    const values = keys.map(k => (k === 'tracks' ? JSON.stringify(req.body[k] || []) : (req.body[k] === '' ? null : req.body[k])));
    values.push(id, req.labelId);
    const { rows } = await pool.query(
      `UPDATE clearances SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Clearance not found' });

    const row = rows[0];
    let fileId = prior.rows[0].file_id;
    // Moved to a different artist — the old artist's Documents tab must stop
    // claiming this chart.
    if (row.artist_id !== prior.rows[0].artist_id && fileId) { await dropFile(fileId, req.labelId); fileId = null; }
    fileId = await generateAndAttach({
      clearance: row, artistId: row.artist_id, name: await artistName(row.artist_id, req.labelId),
      labelId: req.labelId, existingFileId: fileId, userId: req.user.id,
    });
    await pool.query('UPDATE clearances SET file_id = $1 WHERE id = $2 AND label_id = $3', [fileId, id, req.labelId]);
    res.json({ success: true, data: { ...row, file_id: fileId } });
  } catch (error) {
    console.error('Update clearance error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/clearances/:id — also removes the filed chart from the artist's
// Documents tab.
router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT file_id FROM clearances WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Clearance not found' });
    await dropFile(rows[0].file_id, req.labelId);
    await pool.query('DELETE FROM clearances WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete clearance error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/clearances/:id/download — regenerate the XLSX from saved data.
router.get('/:id(\\d+)/download', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name, ef.original_name AS file_filename FROM clearances c
       LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       LEFT JOIN entity_files ef ON ef.id = c.file_id AND ef.label_id = c.label_id
       WHERE c.id = $1 AND c.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Clearance not found' });
    const c = rows[0];
    const buffer = await buildClearanceXlsx(c, c.artist_name);
    // Prefer the name the filed copy already carries so the download and the
    // Documents-tab entry match.
    const fname = c.file_filename || chartFilename(c.artist_name || 'artist', c.title);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Clearance download error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

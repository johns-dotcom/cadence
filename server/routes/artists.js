const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile } = require('../lib/r2');
const spotify = require('../lib/spotify');

const router = express.Router();
router.use(authMiddleware, withTenant);

// POST /api/artists/:id/sync-spotify — pull followers/popularity/image from
// Spotify by the artist's name and fill any blank profile fields.
router.post('/:id/sync-spotify', async (req, res) => {
  try {
    if (!spotify.isEnabled()) return res.status(400).json({ success: false, error: 'Spotify is not configured on the server' });
    const id = parseInt(req.params.id, 10);
    const a = await pool.query('SELECT id, name, image_url, spotify_url FROM artists WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!a.rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    const stats = await spotify.artistStats(a.rows[0].name).catch(() => null);
    if (!stats) return res.status(404).json({ success: false, error: 'Artist not found on Spotify' });
    const { rows } = await pool.query(
      `UPDATE artists SET
         spotify_followers = $1, spotify_popularity = $2,
         image_url = COALESCE(image_url, $3), spotify_url = COALESCE(spotify_url, $4),
         genre = COALESCE(genre, $5)
       WHERE id = $6 AND label_id = $7
       RETURNING spotify_followers, spotify_popularity, image_url, spotify_url`,
      [stats.spotify_followers, stats.spotify_popularity, stats.image_url, stats.spotify_url, stats.genres?.[0] || null, id, req.labelId]
    );
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Sync spotify error:', error);
    res.status(500).json({ success: false, error: 'Spotify sync failed' });
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Profile fields editable via PATCH (beyond name/genre).
const PROFILE_FIELDS = [
  'image_url', 'bio', 'website', 'spotify_url', 'apple_music_url',
  'instagram', 'tiktok', 'youtube', 'soundcloud',
  'spotify_monthly_listeners', 'spotify_followers', 'spotify_popularity',
  'archived',
];

// GET /api/artists — roster for the current label
router.get('/', async (req, res) => {
  try {
    const includeArchived = req.query.include_archived === '1';
    const { rows } = await pool.query(
      `SELECT a.id, a.name, a.genre, a.image_url, a.archived, a.created_at,
              COUNT(r.id)::int AS total_releases
       FROM artists a
       LEFT JOIN releases r ON r.artist_id = a.id AND r.label_id = a.label_id
       WHERE a.label_id = $1 ${includeArchived ? '' : 'AND (a.archived = false OR a.archived IS NULL)'}
       GROUP BY a.id
       ORDER BY a.name`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List artists error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/artists/:id — full profile + the artist's releases (label-scoped).
router.get('/:id', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      'SELECT * FROM artists WHERE id = $1 AND label_id = $2',
      [artistId, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    const [releases, contracts] = await Promise.all([
      pool.query(
        `SELECT id, project_name, release_date, release_type, status, cover_art_url
         FROM releases WHERE label_id = $1 AND artist_id = $2
         ORDER BY release_date DESC NULLS LAST`,
        [req.labelId, artistId]
      ),
      pool.query(
        `SELECT id, type, status, date_signed, expiration_date, royalty_split, advance, territory, file_name
         FROM contracts WHERE label_id = $1 AND artist_id = $2
         ORDER BY date_signed DESC NULLS LAST`,
        [req.labelId, artistId]
      ),
    ]);
    res.json({ success: true, data: { ...rows[0], releases: releases.rows, contracts: contracts.rows } });
  } catch (error) {
    console.error('Get artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/artists
router.post('/', async (req, res) => {
  try {
    const { name, genre } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Name is required' });
    const { rows } = await pool.query(
      `INSERT INTO artists (label_id, name, genre, created_at) VALUES ($1, $2, $3, NOW())
       RETURNING id, name, genre, created_at`,
      [req.labelId, name.trim(), genre || null]
    );
    await logActivity(req, 'Added artist', name.trim());
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ success: false, error: 'An artist with that name already exists' });
    }
    console.error('Create artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/artists/:id — name, genre and any profile field.
router.patch('/:id', async (req, res) => {
  try {
    const editable = ['name', 'genre', ...PROFILE_FIELDS];
    const keys = Object.keys(req.body).filter(k => editable.includes(k));
    if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => (req.body[k] === '' ? null : req.body[k]));
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE artists SET ${setClauses.join(', ')}
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ success: false, error: 'An artist with that name already exists' });
    console.error('Update artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Development log (A&R timeline) ───────────────────────────────────────
// All scoped to (label_id, artist_id); artist ownership is implied by the
// label match on the artist row in each query.

// GET /api/artists/:id/log
router.get('/:id/log', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `SELECT l.id, l.entry_type, l.note, l.log_date, l.created_at, u.name AS author
       FROM artist_dev_log l
       LEFT JOIN users u ON u.id = l.created_by AND u.label_id = l.label_id
       WHERE l.label_id = $1 AND l.artist_id = $2
       ORDER BY l.log_date DESC, l.id DESC`,
      [req.labelId, artistId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List dev log error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/artists/:id/log
router.post('/:id/log', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id, 10);
    const note = (req.body.note || '').trim();
    if (!note) return res.status(400).json({ success: false, error: 'Note is required' });
    // Re-validate the artist is in this label before logging against it.
    const owner = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [artistId, req.labelId]);
    if (!owner.rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    const { rows } = await pool.query(
      `INSERT INTO artist_dev_log (label_id, artist_id, entry_type, note, log_date, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6) RETURNING *`,
      [req.labelId, artistId, req.body.entry_type || 'Note', note, req.body.log_date || null, req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create dev log error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/artists/:id/log/:logId
router.delete('/:id/log/:logId', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM artist_dev_log WHERE id = $1 AND artist_id = $2 AND label_id = $3',
      [parseInt(req.params.logId, 10), parseInt(req.params.id, 10), req.labelId]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete dev log error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/artists/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM artists WHERE id = $1 AND label_id = $2',
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Artist not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Artist file attachments (via entity_files) ───────────────────────────

// GET /api/artists/:id/files — metadata only.
router.get('/:id/files', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, original_name, mime_type, created_at FROM entity_files
       WHERE label_id = $1 AND entity_type = 'artist' AND entity_id = $2 ORDER BY created_at DESC`,
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List artist files error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/artists/:id/files — upload an attachment to R2.
router.post('/:id/files', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const id = parseInt(req.params.id, 10);
    const owner = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!owner.rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `label-${req.labelId}/artist/${id}-${Date.now()}-${safe}`;
    await uploadFile(key, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO entity_files (label_id, entity_type, entity_id, filename, original_name, mime_type, r2_key)
       VALUES ($1, 'artist', $2, $3, $4, $5, $6) RETURNING id, original_name, mime_type, created_at`,
      [req.labelId, id, key, req.file.originalname, req.file.mimetype, key]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Artist file upload error:', error);
    res.status(500).json({ success: false, error: 'File upload failed' });
  }
});

// GET /api/artists/:id/files/:fileId — signed URL.
router.get('/:id/files/:fileId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r2_key FROM entity_files WHERE id = $1 AND label_id = $2 AND entity_type = 'artist' AND entity_id = $3`,
      [parseInt(req.params.fileId, 10), req.labelId, parseInt(req.params.id, 10)]
    );
    if (!rows.length || !rows[0].r2_key) return res.status(404).json({ success: false, error: 'File not found' });
    const url = await getSignedFileUrl(rows[0].r2_key, 3600);
    res.json({ success: true, data: { url } });
  } catch (error) {
    console.error('Artist file url error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/artists/:id/files/:fileId
router.delete('/:id/files/:fileId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r2_key FROM entity_files WHERE id = $1 AND label_id = $2 AND entity_type = 'artist' AND entity_id = $3`,
      [parseInt(req.params.fileId, 10), req.labelId, parseInt(req.params.id, 10)]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'File not found' });
    await pool.query('DELETE FROM entity_files WHERE id = $1 AND label_id = $2', [parseInt(req.params.fileId, 10), req.labelId]);
    if (rows[0].r2_key) deleteFile(rows[0].r2_key).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    console.error('Delete artist file error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

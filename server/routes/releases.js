const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { recordMentions } = require('../lib/mentions');
const activityBot = require('../lib/activityBot');
const spotify = require('../lib/spotify');
const { RELEASE_CHECKLIST_COLUMNS } = require('../lib/constants');

const router = express.Router();
router.use(authMiddleware, withTenant);

// Per-release audit trail. Fire-and-forget: an audit write must never fail the
// mutation it is recording. Separate from activity_log because the release
// Activity tab needs a PRECISE per-entity history — matching activity_log's
// free-text `detail` by project name pulls in unrelated rows and orphans
// history on rename.
function auditRelease(req, releaseId, action, field, oldValue, newValue) {
  pool.query(
    `INSERT INTO release_audit_log (label_id, release_id, user_id, user_name, action, field, old_value, new_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [req.labelId, releaseId, req.user?.id || null, req.user?.name || null, action, field || null,
      oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue)]
  ).catch(() => {});
}

// Find-or-create an artist BY NAME inside this label. Returns null for a blank
// name. Case-insensitive so "Nova" never becomes a second "nova".
async function resolveArtistByName(labelId, rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const { rows } = await pool.query(
    'SELECT id FROM artists WHERE label_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1', [labelId, name]
  );
  if (rows.length) return rows[0].id;
  const created = await pool.query(
    'INSERT INTO artists (label_id, name, created_at) VALUES ($1,$2,NOW()) RETURNING id', [labelId, name]
  );
  return created.rows[0].id;
}

// Re-read a release with its joined artist + assignee names, so every mutating
// route returns exactly the shape the list endpoint returns.
async function fullRelease(id, labelId) {
  const { rows } = await pool.query(
    `SELECT r.*, a.name AS artist_name, u.name AS assignee_name
       FROM releases r
       LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
       LEFT JOIN users u ON u.id = r.assigned_to AND u.label_id = r.label_id
      WHERE r.id = $1 AND r.label_id = $2`,
    [id, labelId]
  );
  return rows[0] || null;
}

const isAdminRole = (req) => ['Superadmin', 'Admin'].includes(req.user?.role);

// POST /api/releases/sync-artwork — bulk cover-art sync (label-scoped).
// Two-phase server batch, called in a loop by the Dashboard's Latest Releases
// row and (later) the Catalog page:
//   Phase 1 — releases WITH a spotify_uri but no artwork: resolve the URI.
//   Phase 2 — everything still bare: strict artist+title search.
// Body params (all optional): { days, force, retry }
//   days  — scope to releases in the last N days (0/absent = whole catalog).
//   force — NULL out cover_art_url in scope first so every release re-evaluates.
//   retry — reprocess rows previously stamped 'not_found'.
// Permanent misses are stamped with the 'not_found' sentinel so they are never
// retried forever; transient Spotify errors leave the row NULL for next sync.
// `remaining` excludes 'not_found' so the client's batching loop terminates.
router.post('/sync-artwork', async (req, res) => {
  try {
    // Graceful no-op when Spotify isn't configured — total 0 ends any loop.
    if (!spotify.isEnabled()) {
      return res.json({ success: true, data: { updated: 0, total: 0, remaining: 0, searched: 0, search_found: 0, disabled: true } });
    }

    const includeNotFound = req.body.retry === true;
    // Sanitized int — safe to interpolate into the INTERVAL literal.
    const days = Math.max(0, parseInt(req.body.days ?? req.query.days, 10) || 0);
    const recentClause = days > 0 ? ` AND release_date >= CURRENT_DATE - INTERVAL '${days} days'` : '';
    const recentClauseR = days > 0 ? ` AND r.release_date >= CURRENT_DATE - INTERVAL '${days} days'` : '';

    // force=true resets cover_art_url in scope so the sync re-evaluates every
    // release from scratch. Safe: Phase 1 re-populates URI'd rows with the
    // canonical Spotify image and Phase 2 only writes strict matches.
    if (req.body.force === true) {
      await pool.query(`UPDATE releases SET cover_art_url = NULL WHERE label_id = $1${recentClause}`, [req.labelId]);
    }

    // Phase 1: releases with a Spotify URI but no artwork.
    const { rows } = await pool.query(
      `SELECT id, spotify_uri FROM releases
        WHERE label_id = $1 AND spotify_uri IS NOT NULL AND spotify_uri != ''
          AND (cover_art_url IS NULL OR cover_art_url = '' ${includeNotFound ? "OR cover_art_url = 'not_found'" : ''})${recentClause}
        LIMIT 500`,
      [req.labelId]
    );

    let updated = 0;
    for (const r of rows) {
      try {
        const url = await spotify.artworkByRef(r.spotify_uri);
        if (url) {
          await pool.query(`UPDATE releases SET cover_art_url = $1 WHERE id = $2 AND label_id = $3`, [url, r.id, req.labelId]);
          updated++;
        } else {
          // Permanent: bad URI format, Spotify 404, or no images.
          await pool.query(`UPDATE releases SET cover_art_url = 'not_found' WHERE id = $1 AND label_id = $2`, [r.id, req.labelId]).catch(() => {});
        }
      } catch (err) {
        // Transient (rate limit, 5xx, network) — leave NULL so next sync retries.
        console.warn(`[sync-artwork] phase1 transient error on #${r.id}:`, err.message);
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Phase 2: still-bare releases (URI-less, or Phase 1 couldn't resolve).
    const { rows: noUri } = await pool.query(
      `SELECT r.id, r.project_name, a.name AS artist_name
         FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
        WHERE r.label_id = $1
          AND (r.cover_art_url IS NULL OR r.cover_art_url = '' ${includeNotFound ? "OR r.cover_art_url = 'not_found'" : ''})${recentClauseR}
        LIMIT 200`,
      [req.labelId]
    );

    let searchUpdated = 0;
    for (const r of noUri) {
      try {
        const url = await spotify.searchArtwork(r.artist_name, r.project_name);
        if (url) {
          await pool.query(`UPDATE releases SET cover_art_url = $1 WHERE id = $2 AND label_id = $3`, [url, r.id, req.labelId]);
          searchUpdated++;
        } else {
          // Strict matcher found nothing it trusts — stamp so the batch loop
          // terminates. Pasting a spotify_uri manually overrides later.
          await pool.query(`UPDATE releases SET cover_art_url = 'not_found' WHERE id = $1 AND label_id = $2`, [r.id, req.labelId]).catch(() => {});
        }
      } catch (err) {
        console.warn(`[sync-artwork] phase2 transient error on #${r.id}:`, err.message);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    updated += searchUpdated;

    const remaining = await pool.query(
      `SELECT COUNT(*)::int AS n FROM releases
        WHERE label_id = $1 AND (cover_art_url IS NULL OR cover_art_url = '')${recentClause}`,
      [req.labelId]
    );

    res.json({
      success: true,
      data: {
        updated,
        total: rows.length + noUri.length,
        remaining: remaining.rows[0].n,
        searched: noUri.length,
        search_found: searchUpdated,
      },
    });
  } catch (error) {
    console.error('Bulk sync-artwork error:', error);
    res.status(500).json({ success: false, error: 'Artwork sync failed' });
  }
});

// POST /api/releases/:id/sync-artwork — fetch cover art from Spotify (by the
// release's spotify_uri, else a title+artist search) and store the URL.
router.post('/:id/sync-artwork', async (req, res) => {
  try {
    if (!spotify.isEnabled()) return res.status(400).json({ success: false, error: 'Spotify is not configured on the server' });
    const { rows } = await pool.query(
      `SELECT r.id, r.project_name, r.spotify_uri, a.name AS artist_name
       FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
       WHERE r.id = $1 AND r.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Release not found' });
    const r = rows[0];
    const url = await spotify.coverArt({ spotifyUri: r.spotify_uri, title: r.project_name, artist: r.artist_name }).catch(() => null);
    if (!url) return res.status(404).json({ success: false, error: 'No artwork found on Spotify for this release' });
    await pool.query('UPDATE releases SET cover_art_url = $1, updated_at = NOW() WHERE id = $2 AND label_id = $3', [url, r.id, req.labelId]);
    res.json({ success: true, data: { cover_art_url: url } });
  } catch (error) {
    console.error('Sync artwork error:', error);
    res.status(500).json({ success: false, error: 'Artwork sync failed' });
  }
});

// GET /api/releases — release pipeline for the current label.
//
// Default scope is the PIPELINE: unarchived and not-yet-cataloged. Callers that
// want a wider set opt in explicitly:
//   archived    'true' archived only · 'false' unarchived only · 'any' both
//               (default: unarchived only)
//   in_catalog  'true' catalog only  · 'any' both  (default: pipeline only)
// Other params: status, q/search (project · artist · ISRC · UPC), month
// (YYYY or YYYY-MM), date_from, date_to, artist (substring), genre, priority,
// release_type (alias `type`) — all matched case-insensitively — upcoming
// ('true' future-dated, 'false' past-dated) and limit.
//
// Ordering follows the scope: upcoming reads soonest-first, everything else
// newest-first, because a pipeline is a countdown and a catalog is a history.
router.get('/', async (req, res) => {
  try {
    const {
      status, q, search, month, date_from, date_to, artist, genre, priority,
      release_type, type, upcoming, archived, in_catalog,
    } = req.query;
    const params = [req.labelId];
    let where = 'r.label_id = $1';
    const eq = (col, val) => { params.push(val); where += ` AND LOWER(${col}) = LOWER($${params.length})`; };

    if (in_catalog === 'true') where += ' AND r.in_catalog = true';
    else if (in_catalog !== 'any') where += ' AND (r.in_catalog = false OR r.in_catalog IS NULL)';

    if (archived === 'true') where += ' AND r.archived = true';
    else if (archived !== 'any') where += ' AND (r.archived = false OR r.archived IS NULL)';

    if (status) { params.push(status); where += ` AND r.status = $${params.length}`; }

    // assigned_to: an integer user id, or 'me'. Powers My Work's release rail —
    // "the records I own" is otherwise only answerable by fetching the pipeline and
    // filtering in the browser.
    if (req.query.assigned_to) {
      const owner = req.query.assigned_to === 'me' ? req.user.id : parseInt(req.query.assigned_to, 10);
      if (!Number.isInteger(owner)) return res.status(400).json({ success: false, error: 'Invalid assigned_to' });
      params.push(owner);
      where += ` AND r.assigned_to = $${params.length}`;
    }

    // `q` (cadence) and `search` (boom) are the same 4-field search.
    const term = search || q;
    if (term) {
      params.push(`%${term}%`);
      where += ` AND (r.project_name ILIKE $${params.length} OR a.name ILIKE $${params.length}`
             + ` OR r.isrc ILIKE $${params.length} OR r.upc ILIKE $${params.length})`;
    }

    if (month && /^\d{4}(-\d{2})?$/.test(String(month))) {
      params.push(month);
      where += ` AND TO_CHAR(r.release_date, '${month.length === 4 ? 'YYYY' : 'YYYY-MM'}') = $${params.length}`;
    }
    if (date_from && /^\d{4}-\d{2}-\d{2}$/.test(String(date_from))) { params.push(date_from); where += ` AND r.release_date >= $${params.length}`; }
    if (date_to && /^\d{4}-\d{2}-\d{2}$/.test(String(date_to))) { params.push(date_to); where += ` AND r.release_date <= $${params.length}`; }
    if (artist) { params.push(`%${artist}%`); where += ` AND a.name ILIKE $${params.length}`; }
    if (genre) eq('r.genre', genre);
    if (priority) eq('r.priority', priority);
    if (release_type || type) eq('r.release_type', release_type || type);

    const isUpcoming = upcoming === 'true';
    if (isUpcoming) where += ' AND r.release_date >= CURRENT_DATE';
    else if (upcoming === 'false') where += ' AND r.release_date < CURRENT_DATE';

    const order = isUpcoming
      ? 'r.release_date ASC NULLS LAST, r.created_at DESC'
      : 'r.release_date DESC NULLS LAST, r.created_at DESC';
    // Sanitized int — safe to interpolate.
    const limit = Math.max(0, Math.min(2000, parseInt(req.query.limit, 10) || 0));

    const { rows } = await pool.query(
      `SELECT r.*, a.name AS artist_name, u.name AS assignee_name
       FROM releases r
       LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
       LEFT JOIN users u ON u.id = r.assigned_to AND u.label_id = r.label_id
       WHERE ${where}
       ORDER BY ${order}${limit ? ` LIMIT ${limit}` : ''}`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List releases error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/releases/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, a.name AS artist_name, u.name AS assignee_name
       FROM releases r
       LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
       LEFT JOIN users u ON u.id = r.assigned_to AND u.label_id = r.label_id
       WHERE r.id = $1 AND r.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Release not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get release error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/releases — create. Accepts either `artist_id` (re-validated
// in-tenant) or a free-text `artist_name`, which is found-or-created inside
// this label so the Add Release form can type a brand-new artist.
router.post('/', async (req, res) => {
  try {
    const { artist_id, artist_name, project_name, release_date } = req.body;
    if (!project_name || !project_name.trim()) {
      return res.status(400).json({ success: false, error: 'Project name is required' });
    }
    if (!release_date) {
      return res.status(400).json({ success: false, error: 'Release date is required' });
    }

    // If an artist_id is supplied, verify it belongs to THIS label before
    // linking — never trust a client-supplied foreign key across tenants.
    let finalArtistId = null;
    if (artist_id) {
      const { rows: a } = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [artist_id, req.labelId]);
      if (!a.length) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
      finalArtistId = artist_id;
    } else if (artist_name) {
      finalArtistId = await resolveArtistByName(req.labelId, artist_name);
    }

    const cols = ['label_id', 'artist_id', 'project_name', 'release_date'];
    const vals = [req.labelId, finalArtistId, project_name.trim(), release_date];
    for (const k of ['release_type', 'genre', 'subgenre', 'priority', 'producer', 'featured_artists',
      'upc', 'isrc', 'spotify_uri', 'apple_music_link', 'presave_link', 'distributor_notes',
      'notes', 'cover_art_status', 'status']) {
      if (req.body[k] !== undefined && req.body[k] !== '') { cols.push(k); vals.push(req.body[k]); }
    }
    const { rows } = await pool.query(
      `INSERT INTO releases (${cols.join(', ')}, created_at, updated_at)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, NOW(), NOW()) RETURNING id`,
      vals
    );
    const created = await fullRelease(rows[0].id, req.labelId);
    await logActivity(req, 'Created release', `${project_name.trim()} (release #${created.id})`);
    auditRelease(req, created.id, 'created', null, null, created.project_name);
    activityBot.postEvent(req.labelId, {
      text: `💿 New release added: ${created.artist_name ? `*${created.artist_name}* — ` : ''}*${created.project_name}*`,
      icon: 'disc', link: `/releases/${created.id}`,
    });
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Create release error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Columns the client is allowed to patch. Anything else in the body is
// ignored — keeps an updatable allowlist instead of trusting arbitrary keys.
const CHECKLIST_COLUMNS = RELEASE_CHECKLIST_COLUMNS;
const UPDATABLE = [
  'artist_id', 'project_name', 'release_date', 'release_type', 'genre', 'subgenre', 'status',
  'upc', 'isrc', 'spotify_uri', 'cover_art_url', 'priority', 'notes',
  'producer', 'featured_artists', 'budget_cap', 'assigned_to',
  'apple_id', 'presave_link', 'presave_analytics', 'ugc_link', 'apple_music_link',
  'distributor_notes', 'cover_art_status',
  ...CHECKLIST_COLUMNS, 'archived',
];
// Core fields worth a human-readable line in the release's history. Checklist
// toggles are audited too, but under their own action so the Activity tab can
// tell "renamed the project" from "ticked Musixmatch".
const AUDITED = ['project_name', 'release_date', 'release_type', 'genre', 'subgenre', 'priority', 'status', 'artist_id', 'assigned_to', 'archived'];

// PATCH /api/releases/:id — partial update of any allowed field(s).
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Bad release id' });

    const body = { ...req.body };
    // `artist_name` is a convenience alias — find-or-create, then fall through
    // to the normal artist_id path so the tenant check below still applies.
    if (body.artist_name !== undefined && body.artist_id === undefined) {
      body.artist_id = await resolveArtistByName(req.labelId, body.artist_name);
      delete body.artist_name;
    }

    // A release must always have a name. An empty Metadata field means "clear
    // this", but project_name is NOT NULL and is how the record is identified
    // everywhere — blanking it would leave an unfindable row.
    if ('project_name' in body) {
      const name = String(body.project_name || '').trim();
      if (!name) return res.status(400).json({ success: false, error: 'Project name cannot be blank' });
      body.project_name = name;
    }

    const keys = Object.keys(body).filter(k => UPDATABLE.includes(k));
    if (keys.length === 0) {
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }

    // Never trust a client-supplied assignee or artist across tenants.
    if (body.assigned_to) {
      const { rows: u } = await pool.query('SELECT 1 FROM users WHERE id = $1 AND label_id = $2', [body.assigned_to, req.labelId]);
      if (!u.length) return res.status(400).json({ success: false, error: 'Assignee not found in this workspace' });
    }
    if (body.artist_id) {
      const { rows: a } = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [body.artist_id, req.labelId]);
      if (!a.length) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    }

    // Read the row FIRST so the audit trail can carry real old→new values.
    const before = await fullRelease(id, req.labelId);
    if (!before) return res.status(404).json({ success: false, error: 'Release not found' });

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => body[k]);
    values.push(id, req.labelId);

    const { rows } = await pool.query(
      `UPDATE releases SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING id`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Release not found' });
    const after = await fullRelease(id, req.labelId);

    // Record what actually changed. Without this the Activity tab starves:
    // checklist, archive, status, priority and owner edits all flow through
    // this one route and were previously invisible.
    for (const k of keys) {
      if (String(before[k] ?? '') === String(after[k] ?? '')) continue;
      if (CHECKLIST_COLUMNS.includes(k)) {
        const label = k.replace(/_/g, ' ');
        auditRelease(req, id, 'checklist', label, before[k] ? 'checked' : 'unchecked', after[k] ? 'checked' : 'unchecked');
        logActivity(req, 'Release checklist', `${after[k] ? 'Checked' : 'Unchecked'} "${label}" on release #${id}`);
      } else if (AUDITED.includes(k)) {
        auditRelease(req, id, 'updated', k, before[k], after[k]);
        logActivity(req, 'Updated release', `Changed ${k.replace(/_/g, ' ')} on release #${id} (${after.project_name})`);
      } else {
        auditRelease(req, id, 'updated', k, before[k], after[k]);
      }
    }
    res.json({ success: true, data: after });
  } catch (error) {
    console.error('Update release error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/releases/:id/archive — NOT-toggle the archived flag.
// Its own endpoint (rather than a PATCH) so the toggle is atomic: two people
// clicking Archive at once can't both read `false` and both write `true`.
router.put('/:id/archive', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `UPDATE releases SET archived = NOT COALESCE(archived, false), updated_at = NOW()
        WHERE id = $1 AND label_id = $2 RETURNING id, archived, project_name`,
      [id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Release not found' });
    const { archived } = rows[0];
    await logActivity(req, archived ? 'Archived release' : 'Unarchived release', `release #${id} (${rows[0].project_name})`);
    auditRelease(req, id, 'archive', 'archived', !archived, archived);
    res.json({ success: true, data: await fullRelease(id, req.labelId) });
  } catch (error) {
    console.error('Archive release error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/releases/:id/catalog — NOT-toggle catalog membership ("Mark as
// Released" one way, "Move back to tracker" the other). Also sets
// catalog_locked so the date-based boot backfill never reverses a human call.
router.put('/:id/catalog', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `UPDATE releases SET in_catalog = NOT COALESCE(in_catalog, false), catalog_locked = TRUE, updated_at = NOW()
        WHERE id = $1 AND label_id = $2 RETURNING id, in_catalog, project_name`,
      [id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Release not found' });
    const { in_catalog } = rows[0];
    await logActivity(req, in_catalog ? 'Moved release to catalog' : 'Moved release to pipeline', `release #${id} (${rows[0].project_name})`);
    auditRelease(req, id, 'catalog', 'in_catalog', !in_catalog, in_catalog);
    res.json({ success: true, data: await fullRelease(id, req.labelId) });
  } catch (error) {
    console.error('Catalog release error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/releases/:id/audit — the precise per-release history.
router.get('/:id/audit', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await releaseInLabel(id, req.labelId))) return res.status(404).json({ success: false, error: 'Release not found' });
    const { rows } = await pool.query(
      `SELECT id, action, field, old_value, new_value, user_name, created_at
         FROM release_audit_log WHERE label_id = $1 AND release_id = $2
        ORDER BY created_at DESC LIMIT 100`,
      [req.labelId, id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Release audit error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/releases/:id — permanent, so Admin-only (matches the merge bar).
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      'DELETE FROM releases WHERE id = $1 AND label_id = $2 RETURNING id, project_name',
      [id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Release not found' });
    await logActivity(req, 'Deleted release', `"${rows[0].project_name}" (release #${id})`);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete release error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Confirm a release belongs to the caller's workspace before touching its
// sub-resources.
async function releaseInLabel(id, labelId) {
  const { rows } = await pool.query('SELECT 1 FROM releases WHERE id = $1 AND label_id = $2', [id, labelId]);
  return rows.length > 0;
}

// GET /api/releases/:id/activity — this release's history.
//
// Sourced from `release_audit_log` (precise, per-entity) plus the workspace
// activity_log rows that name this release by ID. Matching on `release #<id>`
// rather than the project NAME matters: a name match pulls in unrelated rows
// whenever a title is short or common, and orphans the whole history the
// moment somebody renames the project.
router.get('/:id/activity', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Bad release id' });
    if (!(await releaseInLabel(id, req.labelId))) return res.status(404).json({ success: false, error: 'Release not found' });

    const [log, audit] = await Promise.all([
      pool.query(
        `SELECT al.id, al.action, al.detail, al.created_at, u.name AS user_name
           FROM activity_log al LEFT JOIN users u ON u.id = al.user_id AND u.label_id = al.label_id
          WHERE al.label_id = $1 AND al.detail ILIKE $2
          ORDER BY al.created_at DESC LIMIT 40`,
        [req.labelId, `%release #${id}%`]
      ),
      pool.query(
        `SELECT id, action, field, old_value, new_value, user_name, created_at
           FROM release_audit_log WHERE label_id = $1 AND release_id = $2
          ORDER BY created_at DESC LIMIT 40`,
        [req.labelId, id]
      ),
    ]);

    // One merged, newest-first stream. Audit rows are rendered from their
    // field/old/new triple; activity rows keep their free-text detail.
    const rows = [
      ...log.rows.map(r => ({ ...r, kind: 'activity', key: `a${r.id}` })),
      ...audit.rows.map(r => ({
        key: `d${r.id}`, kind: 'audit', id: r.id, user_name: r.user_name, created_at: r.created_at,
        action: r.action, field: r.field, old_value: r.old_value, new_value: r.new_value,
        detail: r.action === 'checklist'
          ? `${r.new_value === 'checked' ? 'Checked' : 'Unchecked'} "${r.field}"`
          : `${(r.field || 'record').replace(/_/g, ' ')}: ${r.old_value || '—'} → ${r.new_value || '—'}`,
      })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 60);

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Release activity error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Comments ─────────────────────────────────────────────────────────────

// GET /api/releases/:id/comments
router.get('/:id/comments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.name AS author, u.role AS author_role
       FROM release_comments c LEFT JOIN users u ON u.id = c.user_id AND u.label_id = c.label_id
       WHERE c.label_id = $1 AND c.release_id = $2 ORDER BY c.created_at ASC`,
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List comments error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/releases/:id/comments
router.post('/:id/comments', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = (req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Comment is required' });
    if (!(await releaseInLabel(id, req.labelId))) return res.status(404).json({ success: false, error: 'Release not found' });
    const { rows } = await pool.query(
      `INSERT INTO release_comments (label_id, release_id, user_id, body) VALUES ($1,$2,$3,$4) RETURNING id, body, created_at`,
      [req.labelId, id, req.user.id, body]
    );
    try { await recordMentions({ labelId: req.labelId, actorId: req.user.id, body, source: 'release_comment', sourceId: id, link: `/releases/${id}` }); } catch (e) { /* mentions are best-effort */ }
    res.status(201).json({ success: true, data: { ...rows[0], user_id: req.user.id, author: req.user.name } });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/releases/:id/comments/:commentId — author or Admin only.
// Label scope alone is not authorization here: every member is inside the
// label, so scope-only meant anyone could delete anyone's comment.
router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const commentId = parseInt(req.params.commentId, 10);
    const releaseId = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      'SELECT user_id FROM release_comments WHERE id = $1 AND release_id = $2 AND label_id = $3',
      [commentId, releaseId, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Comment not found' });
    if (rows[0].user_id !== req.user.id && !isAdminRole(req)) {
      return res.status(403).json({ success: false, error: 'You can only delete your own comments' });
    }
    await pool.query('DELETE FROM release_comments WHERE id = $1 AND label_id = $2', [commentId, req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Budget line items ────────────────────────────────────────────────────

// GET /api/releases/:id/budget — cap + line items + total.
router.get('/:id/budget', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cap = await pool.query('SELECT budget_cap FROM releases WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!cap.rows.length) return res.status(404).json({ success: false, error: 'Release not found' });
    const items = await pool.query('SELECT * FROM release_budget_items WHERE label_id = $1 AND release_id = $2 ORDER BY id', [req.labelId, id]);
    const total = items.rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    res.json({ success: true, data: { budget_cap: cap.rows[0].budget_cap, items: items.rows, total } });
  } catch (error) {
    console.error('Get budget error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/releases/:id/budget/items
router.post('/:id/budget/items', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await releaseInLabel(id, req.labelId))) return res.status(404).json({ success: false, error: 'Release not found' });
    const { rows } = await pool.query(
      `INSERT INTO release_budget_items (label_id, release_id, category, description, amount)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.labelId, id, req.body.category || null, req.body.description || null, parseFloat(req.body.amount) || 0]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create budget item error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/releases/:id/budget/items/:itemId — edit a line item in place.
router.put('/:id/budget/items/:itemId', async (req, res) => {
  try {
    const fields = ['category', 'description', 'amount'].filter(k => k in req.body);
    if (!fields.length) return res.status(400).json({ success: false, error: 'No fields to update' });
    const values = fields.map(k => (k === 'amount' ? parseFloat(req.body.amount) || 0 : (req.body[k] || null)));
    values.push(parseInt(req.params.itemId, 10), parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE release_budget_items SET ${fields.map((k, i) => `${k} = $${i + 1}`).join(', ')}
        WHERE id = $${values.length - 2} AND release_id = $${values.length - 1} AND label_id = $${values.length}
        RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update budget item error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/releases/:id/budget/items/:itemId
router.delete('/:id/budget/items/:itemId', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM release_budget_items WHERE id = $1 AND release_id = $2 AND label_id = $3',
      [parseInt(req.params.itemId, 10), parseInt(req.params.id, 10), req.labelId]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete budget item error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

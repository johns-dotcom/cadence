const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireRole, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile, isConfigured: r2Configured } = require('../lib/r2');
const { cascadeArtistName } = require('../lib/artistCascade');
const spotify = require('../lib/spotify');
const { DEV_LOG_TYPES } = require('../lib/constants');

const router = express.Router();
router.use(authMiddleware, withTenant);

// Contracts carry royalty_split and advance — deal terms. Only the roles that
// can see the Contracts page get them back in the artist aggregate; everyone
// else gets an empty array and the client hides the tab. Two layers on purpose:
// hiding a tab is presentation, not authorization.
const canSeeContracts = (req) => ['Superadmin', 'Admin', 'Approver'].includes(req.user.role);

// 10MB and an extension/MIME allow-list. The roster's Documents panel takes
// riders, IDs, photos, demos and mood boards — not executables.
const FILE_OK = /^(image\/|application\/pdf$|audio\/|video\/|text\/plain$|application\/(msword|vnd\.openxmlformats|vnd\.ms-|zip|x-zip))/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (FILE_OK.test(file.mimetype || '')) return cb(null, true);
    cb(new Error('Unsupported file type'));
  },
});

// Profile fields editable via PATCH (beyond name/genre). `archived` is NOT here
// — it routes through PATCH /:id/archive so the audit stamps always get written.
const PROFILE_FIELDS = [
  'image_url', 'bio', 'website', 'spotify_url', 'apple_music_url',
  'instagram', 'tiktok', 'youtube', 'soundcloud',
  'spotify_monthly_listeners', 'spotify_followers', 'spotify_popularity',
];

// ── Collection routes ────────────────────────────────────────────────────
// These MUST be declared before '/:id' or Express matches "export" as an id.

// GET /api/artists — roster for the current label.
//   ?search           ILIKE on name
//   ?include_archived=1
//   ?page&?limit      paged; the response always carries the unpaged `total`
// `has_recent_release` is derived, not stored: true when the artist has a
// non-archived release dated within the last 365 days OR any time in the
// future (one comparison covers both — next month is also >= a-year-ago). The
// roster's "Active only" filter and Active Roster stat are built on it.
router.get('/', async (req, res) => {
  try {
    const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';
    const search = (req.query.search || '').trim();
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 1000));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * limit;

    const params = [req.labelId];
    let where = 'WHERE a.label_id = $1';
    if (!includeArchived) where += ' AND (a.archived = false OR a.archived IS NULL)';
    if (search) {
      params.push(`%${search}%`);
      where += ` AND a.name ILIKE $${params.length}`;
    }

    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM artists a ${where}`, params);

    const rowParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `SELECT a.id, a.name, a.genre, a.image_url, a.archived, a.archived_at, a.created_at,
              a.spotify_url, a.spotify_followers, a.spotify_monthly_listeners,
              COUNT(r.id)::int AS total_releases,
              EXISTS (
                SELECT 1 FROM releases r2
                 WHERE r2.artist_id = a.id AND r2.label_id = a.label_id
                   AND (r2.archived = false OR r2.archived IS NULL)
                   AND r2.release_date IS NOT NULL
                   AND r2.release_date >= CURRENT_DATE - INTERVAL '365 days'
              ) AS has_recent_release
         FROM artists a
         LEFT JOIN releases r ON r.artist_id = a.id AND r.label_id = a.label_id
         ${where}
         GROUP BY a.id
         ORDER BY a.name
         LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams
    );
    res.json({ success: true, data: rows, total: count.rows[0].n, page, limit });
  } catch (error) {
    console.error('List artists error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/artists/export — roster as XLSX.
//   ?genres=Hip-Hop,Pop   comma list, case-insensitive exact match
//   ?since_days=365       keep only artists with a release in that window
// `last_release_date` is computed for every row regardless of the window so the
// reader can see WHY each artist qualified — useful context even all-time.
router.get('/export', async (req, res) => {
  try {
    const sinceDays = parseInt(req.query.since_days, 10);
    const params = [req.labelId];
    let where = 'WHERE a.label_id = $1 AND (a.archived = false OR a.archived IS NULL)';

    const list = String(req.query.genres || '').split(',').map(g => g.trim()).filter(Boolean);
    if (list.length) {
      const placeholders = list.map((_, i) => `LOWER($${params.length + i + 1})`).join(', ');
      where += ` AND LOWER(COALESCE(a.genre, '')) IN (${placeholders})`;
      params.push(...list);
    }
    if (Number.isFinite(sinceDays) && sinceDays > 0) {
      // Interpolated, not parameterised: Postgres rejects $N inside an INTERVAL
      // literal. parseInt above has already reduced it to a plain integer.
      where += ` AND EXISTS (
        SELECT 1 FROM releases r
         WHERE r.artist_id = a.id AND r.label_id = a.label_id
           AND (r.archived = false OR r.archived IS NULL)
           AND r.release_date IS NOT NULL
           AND r.release_date BETWEEN (CURRENT_DATE - INTERVAL '${sinceDays} days') AND CURRENT_DATE
      )`;
    }

    const { rows } = await pool.query(
      `SELECT a.name, a.genre, a.created_at,
              (SELECT COUNT(*)::int FROM releases r
                WHERE r.artist_id = a.id AND r.label_id = a.label_id
                  AND (r.archived = false OR r.archived IS NULL)) AS total_releases,
              (SELECT MAX(r.release_date) FROM releases r
                WHERE r.artist_id = a.id AND r.label_id = a.label_id
                  AND (r.archived = false OR r.archived IS NULL)) AS last_release_date
         FROM artists a
         ${where}
        ORDER BY a.name ASC`,
      params
    );

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cadence';
    const ws = wb.addWorksheet('Roster');
    ws.columns = [
      { header: 'Artist', key: 'name', width: 32 },
      { header: 'Genre', key: 'genre', width: 22 },
      { header: 'Total Releases', key: 'total_releases', width: 14 },
      { header: 'Last Release Date', key: 'last_release_date', width: 18 },
      { header: 'Date Added', key: 'created_at', width: 14 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    const d = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : '');
    for (const r of rows) {
      ws.addRow({
        name: r.name,
        genre: r.genre || '',
        total_releases: r.total_releases || 0,
        last_release_date: d(r.last_release_date),
        created_at: d(r.created_at),
      });
    }
    ws.getColumn('total_releases').alignment = { horizontal: 'center' };
    ws.getColumn('last_release_date').alignment = { horizontal: 'center' };

    const genreLabel = list.length
      ? list.join('-').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
      : 'all';
    const windowLabel = (Number.isFinite(sinceDays) && sinceDays > 0) ? `-last${sinceDays}d` : '';
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', `attachment; filename="roster-${genreLabel}${windowLabel}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(Buffer.from(buf));
  } catch (error) {
    console.error('Artist export error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/artists/sync-images — roster-wide profile-image sync.
// Same shape as POST /releases/sync-artwork so the two batch syncs behave
// identically for the client: `disabled:true` no-op when Spotify is off, a
// 'not_found' sentinel so permanent misses are never retried forever, and a
// `remaining` count (excluding the sentinel) so a batching loop terminates.
// Link-first: a stored spotify_url resolves by ID, which is exact; the name
// search is only the fallback.
// Body: { force, retry, limit }
router.post('/sync-images', requireApprover, async (req, res) => {
  try {
    if (!spotify.isEnabled()) {
      return res.json({ success: true, data: { updated: 0, total: 0, remaining: 0, not_found: 0, disabled: true } });
    }
    const retry = req.body.retry === true;
    const batch = Math.min(100, Math.max(1, parseInt(req.body.limit, 10) || 40));

    if (req.body.force === true) {
      await pool.query('UPDATE artists SET image_url = NULL WHERE label_id = $1', [req.labelId]);
    }

    const { rows } = await pool.query(
      `SELECT id, name, spotify_url FROM artists
        WHERE label_id = $1 AND (archived = false OR archived IS NULL)
          AND (image_url IS NULL OR image_url = '' ${retry ? "OR image_url = 'not_found'" : ''})
        ORDER BY name
        LIMIT $2`,
      [req.labelId, batch]
    );

    let updated = 0;
    let notFound = 0;
    for (const a of rows) {
      try {
        let url = null;
        // Phase 1 — direct ID lookup off the stored Spotify profile URL.
        const m = String(a.spotify_url || '').match(/artist\/([a-zA-Z0-9]+)/);
        if (m) {
          const data = await spotify.artistById(m[1]).catch(() => null);
          url = data?.image_url || null;
        }
        // Phase 2 — name search.
        if (!url) {
          const stats = await spotify.artistStats(a.name).catch(() => null);
          url = stats?.image_url || null;
        }
        if (url) {
          await pool.query('UPDATE artists SET image_url = $1 WHERE id = $2 AND label_id = $3', [url, a.id, req.labelId]);
          updated++;
        } else {
          // Permanent miss — stamp so the client's loop terminates instead of
          // re-fetching the same misses on every pass.
          await pool.query("UPDATE artists SET image_url = 'not_found' WHERE id = $1 AND label_id = $2", [a.id, req.labelId]).catch(() => {});
          notFound++;
        }
      } catch (err) {
        // Transient (rate limit / 5xx / network) — leave NULL so the next run retries.
        console.warn(`[sync-images] transient error on artist #${a.id}:`, err.message);
      }
      // Space the calls out; Spotify rate-limits hard on bursts.
      await new Promise(r => setTimeout(r, 100));
    }

    const remaining = await pool.query(
      `SELECT COUNT(*)::int AS n FROM artists
        WHERE label_id = $1 AND (archived = false OR archived IS NULL)
          AND (image_url IS NULL OR image_url = '')`,
      [req.labelId]
    );
    res.json({ success: true, data: { updated, not_found: notFound, total: rows.length, remaining: remaining.rows[0].n } });
  } catch (error) {
    console.error('Sync artist images error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

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
         image_url = COALESCE(NULLIF(image_url, 'not_found'), $3), spotify_url = COALESCE(spotify_url, $4),
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

// GET /api/artists/:id/spotify — LIVE Spotify surface for the profile tab:
// profile + top tracks + discography, fanned out at request time. Never
// persisted; the stored columns are the sync's job.
// Degrades to a typed payload the client can render as a state, never a 500:
//   { disabled: true }  — no credentials configured
//   { found: false }    — nothing on Spotify under that name
router.get('/:id/spotify', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const a = await pool.query('SELECT id, name, spotify_url FROM artists WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!a.rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    if (!spotify.isEnabled()) {
      return res.json({ success: true, data: { disabled: true, found: false } });
    }
    const profile = await spotify.artistProfile({ name: a.rows[0].name, url: a.rows[0].spotify_url });
    if (!profile) return res.json({ success: true, data: { disabled: false, found: false } });
    res.json({ success: true, data: { disabled: false, found: true, ...profile } });
  } catch (error) {
    console.error('Artist spotify profile error:', error);
    // A Spotify outage is not a server error the user can act on — hand back a
    // renderable state so the tab shows "couldn't reach Spotify", not a crash.
    res.json({ success: true, data: { disabled: false, found: false, error: 'Could not reach Spotify' } });
  }
});

// GET /api/artists/:id — full profile aggregate.
router.get('/:id', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id, 10);
    if (!Number.isFinite(artistId)) return res.status(404).json({ success: false, error: 'Artist not found' });
    const { rows } = await pool.query(
      'SELECT * FROM artists WHERE id = $1 AND label_id = $2',
      [artistId, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    const artistName = rows[0].name;

    const [releases, contracts, spend, expenses, budget, deals, income] = await Promise.all([
      // `r.*` so the client has the 14 checklist booleans for the completion
      // bars; a 6-column select is why they couldn't be drawn before.
      pool.query(
        `SELECT r.*, u.name AS assigned_to_name
           FROM releases r
           LEFT JOIN users u ON u.id = r.assigned_to AND u.label_id = r.label_id
          WHERE r.label_id = $1 AND r.artist_id = $2
          ORDER BY r.release_date DESC NULLS LAST`,
        [req.labelId, artistId]
      ),
      canSeeContracts(req)
        ? pool.query(
            `SELECT * FROM contracts WHERE label_id = $1 AND artist_id = $2
              ORDER BY expiration_date ASC NULLS LAST, date_signed DESC NULLS LAST`,
            [req.labelId, artistId]
          )
        : Promise.resolve({ rows: [] }),
      // Spend by category AND currency. Summing GBP into USD and printing a
      // '$' fabricates a number; the client renders one string per currency.
      // Leaf rows only (children of splits + unsplit parents) so a split
      // allocation isn't counted twice.
      pool.query(
        `SELECT COALESCE(category, 'Uncategorized') AS category,
                COALESCE(NULLIF(currency, ''), 'USD') AS currency,
                COALESCE(SUM(amount), 0)::numeric AS amount
           FROM expenses e
          WHERE label_id = $1 AND LOWER(TRIM(artist)) = LOWER(TRIM($2)) AND status = 'approved'
            AND (deleted = false OR deleted IS NULL) AND (voided = false OR voided IS NULL)
            AND NOT EXISTS (SELECT 1 FROM expenses c WHERE c.parent_id = e.id)
          GROUP BY 1, 2 ORDER BY SUM(amount) DESC`,
        [req.labelId, artistName]
      ),
      // The rows behind those bars, for the Spends table.
      pool.query(
        `SELECT e.id, e.invoice_date, e.payee, e.description, e.song, e.category,
                e.amount, e.currency, e.payment_status, e.recoupable, e.cobrand
           FROM expenses e
          WHERE e.label_id = $1 AND LOWER(TRIM(e.artist)) = LOWER(TRIM($2)) AND e.status = 'approved'
            AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
            AND NOT EXISTS (SELECT 1 FROM expenses c WHERE c.parent_id = e.id)
          ORDER BY e.invoice_date DESC NULLS LAST, e.id DESC
          LIMIT 500`,
        [req.labelId, artistName]
      ),
      pool.query(
        `SELECT COALESCE(SUM(budget_cap), 0)::numeric AS cap FROM releases WHERE label_id = $1 AND artist_id = $2`,
        [req.labelId, artistId]
      ),
      pool.query(
        `SELECT id, stage, ar_rep, deal_type, offer_amount, last_contact_date, updated_at
           FROM deals WHERE label_id = $1 AND LOWER(TRIM(artist_name)) = LOWER(TRIM($2))
          ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 5`,
        [req.labelId, artistName]
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(currency, ''), 'USD') AS currency, COALESCE(SUM(amount), 0)::numeric AS amount
           FROM artist_income WHERE label_id = $1 AND artist_id = $2 GROUP BY 1`,
        [req.labelId, artistId]
      ),
    ]);

    // Category totals, per currency: [{ category, totals: { USD: n, GBP: n } }].
    const catMap = new Map();
    for (const r of spend.rows) {
      const cur = catMap.get(r.category) || { category: r.category, totals: {} };
      cur.totals[r.currency] = (cur.totals[r.currency] || 0) + Number(r.amount);
      catMap.set(r.category, cur);
    }
    const spendByCategory = [...catMap.values()];
    const spendTotals = {};
    for (const r of spend.rows) spendTotals[r.currency] = (spendTotals[r.currency] || 0) + Number(r.amount);
    const incomeTotals = {};
    for (const r of income.rows) incomeTotals[r.currency] = (incomeTotals[r.currency] || 0) + Number(r.amount);

    // Budget: prefer the artist-level recording budget (line items scaled by
    // contingency, or a total override) and fall back to the sum of per-release
    // caps. A capless release contributes 0, so the fallback silently
    // under-reports for anyone whose budget lives in Recording Budgets.
    let budgetTotal = Number(budget.rows[0]?.cap || 0);
    let budgetSource = 'release_caps';
    const rb = await pool.query(
      `SELECT b.id, b.contingency_pct,
              COALESCE((SELECT SUM(i.amount) FROM recording_budget_items i
                         WHERE i.budget_id = b.id AND i.label_id = b.label_id), 0)::numeric AS items
         FROM recording_budgets b
        WHERE b.label_id = $1 AND LOWER(TRIM(b.artist)) = LOWER(TRIM($2))
          AND COALESCE(b.status, 'draft') <> 'draft'`,
      [req.labelId, artistName]
    ).catch(() => ({ rows: [] }));
    if (rb.rows.length) {
      const total = rb.rows.reduce((sum, b) => sum + Number(b.items) * (1 + Number(b.contingency_pct || 0) / 100), 0);
      if (total > 0) { budgetTotal = total; budgetSource = 'recording_budget'; }
    }

    res.json({
      success: true,
      data: {
        ...rows[0],
        releases: releases.rows,
        contracts: contracts.rows,
        contracts_visible: canSeeContracts(req),
        deals: deals.rows,
        expenses: expenses.rows,
        spendByCategory,
        spendTotals,
        incomeTotals,
        budgetTotal,
        budgetSource,
      },
    });
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

// PATCH /api/artists/:id/archive — archive/restore with audit stamps.
router.patch('/:id/archive', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (typeof req.body.archived !== 'boolean') {
      return res.status(400).json({ success: false, error: '`archived` must be true or false' });
    }
    const { rows } = await pool.query(
      `UPDATE artists
          SET archived = $1,
              archived_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
              archived_by = CASE WHEN $1 THEN $2::int ELSE NULL END
        WHERE id = $3 AND label_id = $4
        RETURNING id, name, archived, archived_at`,
      [req.body.archived, req.user.id, id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    await logActivity(req, req.body.archived ? 'Archived artist' : 'Restored artist', rows[0].name);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Archive artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/artists/:id — name, genre and profile fields.
// A rename is transactional and CASCADES every name-keyed reference; without
// that the artist's own Spends tab reads zero the moment a typo is fixed,
// because the spend query matches on LOWER(TRIM(artist)).
router.patch('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(404).json({ success: false, error: 'Artist not found' });
    const editable = ['name', 'genre', ...PROFILE_FIELDS];
    const keys = Object.keys(req.body).filter(k => editable.includes(k));
    if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });

    await client.query('BEGIN');
    const existing = await client.query('SELECT id, name FROM artists WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!existing.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Artist not found' }); }
    const oldName = existing.rows[0].name;

    const newName = keys.includes('name') ? String(req.body.name || '').trim() : null;
    if (keys.includes('name')) {
      if (!newName) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Name is required' }); }
      // Checked unconditionally, not gated on "did the name change" — the two
      // spellings in a duplicate pair often differ only in case or whitespace,
      // which the unique index folds, so a gated check skips exactly the case
      // that then 500s on artists_label_id_name_key.
      const clash = await client.query(
        'SELECT 1 FROM artists WHERE label_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) AND id <> $3',
        [req.labelId, newName, id]
      );
      if (clash.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: 'Another artist already has that name — merge them instead' });
      }
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => (k === 'name' ? newName : (req.body[k] === '' ? null : req.body[k])));
    values.push(id, req.labelId);
    const { rows } = await client.query(
      `UPDATE artists SET ${setClauses.join(', ')}
        WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (newName && newName.toLowerCase() !== oldName.toLowerCase()) {
      await cascadeArtistName(client, req.labelId, oldName, newName);
    }
    await client.query('COMMIT');
    if (newName && newName !== oldName) await logActivity(req, 'Renamed artist', `${oldName} → ${newName}`);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ success: false, error: 'An artist with that name already exists' });
    console.error('Update artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
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
      `SELECT l.id, l.entry_type, l.note, l.log_date, l.created_at, l.created_by, u.name AS author
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
    // Validated against the whitelist, not accepted as any string — the client
    // colour-codes on this value and the timeline is only groupable if the set
    // is closed.
    const entryType = req.body.entry_type || 'Note';
    if (!DEV_LOG_TYPES.includes(entryType)) {
      return res.status(400).json({ success: false, error: `Invalid entry type. Must be one of: ${DEV_LOG_TYPES.join(', ')}` });
    }
    // Re-validate the artist is in this label before logging against it.
    const owner = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [artistId, req.labelId]);
    if (!owner.rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    const { rows } = await pool.query(
      `INSERT INTO artist_dev_log (label_id, artist_id, entry_type, note, log_date, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6) RETURNING id`,
      [req.labelId, artistId, entryType, note, req.body.log_date || null, req.user.id]
    );
    // Re-read through the list query so the returned row carries `author` and
    // matches the shape the client already has in state.
    const { rows: full } = await pool.query(
      `SELECT l.id, l.entry_type, l.note, l.log_date, l.created_at, l.created_by, u.name AS author
         FROM artist_dev_log l
         LEFT JOIN users u ON u.id = l.created_by AND u.label_id = l.label_id
        WHERE l.id = $1 AND l.label_id = $2`,
      [rows[0].id, req.labelId]
    );
    res.status(201).json({ success: true, data: full[0] });
  } catch (error) {
    console.error('Create dev log error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/artists/:id/log/:logId — author or admin only. Being in the label
// is not authorization when every member is in the label.
router.delete('/:id/log/:logId', async (req, res) => {
  try {
    const logId = parseInt(req.params.logId, 10);
    const { rows } = await pool.query(
      'SELECT id, created_by FROM artist_dev_log WHERE id = $1 AND artist_id = $2 AND label_id = $3',
      [logId, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    const isAdmin = ['Superadmin', 'Admin'].includes(req.user.role);
    if (!isAdmin && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ success: false, error: 'You can only delete your own log entries' });
    }
    await pool.query('DELETE FROM artist_dev_log WHERE id = $1 AND label_id = $2', [logId, req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete dev log error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/artists/:id — Superadmin only. Refuses while releases still
// point here (releases.artist_id is ON DELETE SET NULL, so a bare delete would
// silently orphan catalog rows), and cleans up entity_files rows + R2 objects.
router.delete('/:id', requireRole('Superadmin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(404).json({ success: false, error: 'Artist not found' });
    const artist = await client.query('SELECT id, name FROM artists WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!artist.rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    const rel = await client.query('SELECT COUNT(*)::int AS n FROM releases WHERE artist_id = $1 AND label_id = $2', [id, req.labelId]);
    if (rel.rows[0].n > 0) {
      return res.status(409).json({ success: false, error: `Artist has ${rel.rows[0].n} release(s) — reassign or delete them first` });
    }
    const files = await client.query(
      "SELECT r2_key FROM entity_files WHERE label_id = $1 AND entity_type = 'artist' AND entity_id = $2",
      [req.labelId, id]
    );
    await client.query('BEGIN');
    await client.query("DELETE FROM entity_files WHERE label_id = $1 AND entity_type = 'artist' AND entity_id = $2", [req.labelId, id]);
    await client.query('DELETE FROM artists WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    await client.query('COMMIT');
    for (const row of files.rows) {
      if (row.r2_key) deleteFile(row.r2_key).catch(() => {});
    }
    await logActivity(req, 'Deleted artist', artist.rows[0].name);
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Delete artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── Artist file attachments (via entity_files) ───────────────────────────

// GET /api/artists/:id/files — metadata (size + uploader included; the panel
// shows "size · date · uploader" and can't without them).
router.get('/:id/files', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.original_name, f.mime_type, f.file_size, f.created_at,
              f.uploaded_by, u.name AS uploaded_by_name
         FROM entity_files f
         LEFT JOIN users u ON u.id = f.uploaded_by AND u.label_id = f.label_id
        WHERE f.label_id = $1 AND f.entity_type = 'artist' AND f.entity_id = $2
        ORDER BY f.created_at DESC`,
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
      `INSERT INTO entity_files (label_id, entity_type, entity_id, filename, original_name, mime_type, r2_key, file_size, uploaded_by)
       VALUES ($1, 'artist', $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, original_name, mime_type, file_size, created_at, uploaded_by`,
      [req.labelId, id, key, req.file.originalname, req.file.mimetype, key, req.file.size, req.user.id]
    );
    res.status(201).json({ success: true, data: { ...rows[0], uploaded_by_name: req.user.name } });
  } catch (error) {
    if (error.message === 'Unsupported file type') {
      return res.status(400).json({ success: false, error: 'Unsupported file type' });
    }
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
    if (!r2Configured()) return res.status(503).json({ success: false, error: "File storage is not configured on this deployment." });
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

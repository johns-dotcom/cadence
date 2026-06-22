const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
// Bulk multi-entity import — admin only, one transaction, all label-scoped.
router.use(authMiddleware, withTenant, requireAdmin);

// POST /api/import/master-sheet — accepts pre-parsed arrays from the client's
// CSV/XLSX wizard: { artists:[{name,genre}], releases:[{project_name,artist,
// release_date,...}], expenses:[{payee,amount,...}], income:[{artist,amount,
// source,...}] }. Artists are upserted by name; releases/income resolve their
// artist by name within the label. Returns per-entity counts.
router.post('/master-sheet', async (req, res) => {
  const client = await pool.connect();
  try {
    const { artists = [], releases = [], expenses = [], income = [] } = req.body || {};
    const cap = 2000;
    if (artists.length + releases.length + expenses.length + income.length > cap) {
      return res.status(400).json({ success: false, error: `Too many rows (max ${cap} total per import)` });
    }
    await client.query('BEGIN');
    const counts = { artists: 0, releases: 0, expenses: 0, income: 0 };

    // Resolve-or-create an artist id by name (cached within this request).
    const artistCache = new Map();
    const resolveArtist = async (name) => {
      const key = (name || '').trim().toLowerCase();
      if (!key) return null;
      if (artistCache.has(key)) return artistCache.get(key);
      const found = await client.query('SELECT id FROM artists WHERE label_id = $1 AND LOWER(name) = $2', [req.labelId, key]);
      let id = found.rows[0]?.id;
      if (!id) {
        const ins = await client.query('INSERT INTO artists (label_id, name) VALUES ($1, $2) ON CONFLICT (label_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [req.labelId, name.trim()]);
        id = ins.rows[0].id;
      }
      artistCache.set(key, id);
      return id;
    };

    for (const a of artists) {
      if (!a.name || !a.name.trim()) continue;
      await client.query(
        'INSERT INTO artists (label_id, name, genre) VALUES ($1,$2,$3) ON CONFLICT (label_id, name) DO UPDATE SET genre = COALESCE(EXCLUDED.genre, artists.genre)',
        [req.labelId, a.name.trim(), a.genre || null]
      );
      counts.artists++;
    }

    for (const r of releases) {
      if (!r.project_name || !r.project_name.trim()) continue;
      const artistId = r.artist ? await resolveArtist(r.artist) : null;
      await client.query(
        `INSERT INTO releases (label_id, artist_id, project_name, release_date, release_type, genre, status)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'Draft'))`,
        [req.labelId, artistId, r.project_name.trim(), r.release_date || null, r.release_type || null, r.genre || null, r.status || null]
      );
      counts.releases++;
    }

    for (const e of expenses) {
      if (!e.payee || !e.amount) continue;
      await client.query(
        `INSERT INTO expenses (label_id, invoice_date, payee, description, category, artist, amount, currency, status, payment_status, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'USD'),COALESCE($9,'approved'),COALESCE($10,'Unpaid'),$11,NOW())`,
        [req.labelId, e.invoice_date || null, String(e.payee).trim(), e.description || null, e.category || null, e.artist || null, parseFloat(e.amount) || 0, e.currency || null, e.status || null, e.payment_status || null, req.user.name]
      );
      counts.expenses++;
    }

    for (const i of income) {
      if (!i.amount) continue;
      const artistId = i.artist ? await resolveArtist(i.artist) : null;
      await client.query(
        `INSERT INTO artist_income (label_id, artist_id, source, description, amount, currency, income_date, created_by)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,'USD'),COALESCE($7,CURRENT_DATE),$8)`,
        [req.labelId, artistId, i.source || null, i.description || null, parseFloat(i.amount) || 0, i.currency || null, i.income_date || null, req.user.id]
      );
      counts.income++;
    }

    await client.query('COMMIT');
    await logActivity(req, 'Master-sheet import', `artists ${counts.artists}, releases ${counts.releases}, expenses ${counts.expenses}, income ${counts.income}`);
    res.status(201).json({ success: true, data: counts });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Master-sheet import error:', error);
    res.status(500).json({ success: false, error: 'Import failed' });
  } finally {
    client.release();
  }
});

module.exports = router;

// Artist Campaigns hub — per-artist marketing-spend reconciliation.
// See ARTIST_CAMPAIGNS_SPEC.md. Every query is tenant-scoped. Totals sum LEAF
// rows (split children + unsplit parents) so split allocations never
// double-count and always render. Dismissed rows are hidden; not_campaign rows
// are visible-but-segregated (excluded from stats, admin-only).
const express = require('express');
const ExcelJS = require('exceljs');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { toUSD } = require('../lib/fx');
const { recordMentions } = require('../lib/mentions');

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

// ── helpers ──────────────────────────────────────────────────────────────
const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const songKeyOf = (s) => { const t = String(s || '').trim().toLowerCase(); return t || '__no_song__'; };
const round = (n) => Math.round((n || 0) * 100) / 100;
async function usd(r) {
  if (r.fx_rate_to_usd) return Number(r.amount) / Number(r.fx_rate_to_usd);
  return await toUSD(r.amount, r.currency, r.payment_date || r.invoice_date || r.created_at);
}
const isAdmin = (req) => ['Superadmin', 'Admin'].includes(req.user.role);

// A row is "campaign spend" when flagged TRUE, or (NULL) auto-detected from a
// marketing-ish category. Explicit FALSE removes it.
const CAMPAIGN_WHERE = `(
  e.artist_campaign = TRUE
  OR (e.artist_campaign IS NULL AND e.category IS NOT NULL AND LOWER(e.category) ~ 'market|advertis|promo|influenc|public|social')
)`;
// Leaf rows only + not dismissed. (not_campaign handled per-caller.)
const VISIBLE = `
  e.label_id = $1 AND e.status = 'approved' AND (e.deleted = false OR e.deleted IS NULL)
  AND (e.voided = false OR e.voided IS NULL) AND e.artist IS NOT NULL AND e.artist <> ''
  AND ${CAMPAIGN_WHERE}
  AND NOT EXISTS (SELECT 1 FROM expenses c WHERE c.parent_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM flag_dismissals d WHERE d.expense_id = e.id AND d.flag_kind = 'artist_campaign')`;

// Columns the campaigns surface reads off a row.
const ROW_COLS = `e.id, e.payee, e.artist, e.song, e.category, e.amount, e.currency, e.cobrand,
  e.payment_status, e.payment_date, e.invoice_date, e.created_at, e.rep, e.invoice_number,
  e.parent_id, e.entry_source, e.social_handles, e.item_finished, e.flagged, e.flag_reason,
  e.is_bulk_deal, e.bulk_deal_quantity, e.bulk_deal_unit, e.bulk_deal_completed, e.fx_rate_to_usd,
  e.invoice_r2_key IS NOT NULL AS has_invoice,
  (SELECT COUNT(*)::int FROM expense_comments c WHERE c.expense_id = e.id) AS comment_count,
  (SELECT json_agg(json_build_object('id', u.id, 'name', u.name)) FROM review_assignments ra JOIN users u ON u.id = ra.assignee_id WHERE ra.expense_id = e.id) AS review_assignees,
  EXISTS (SELECT 1 FROM flag_dismissals d WHERE d.expense_id = e.id AND d.flag_kind = 'artist_campaign_not_campaign') AS not_campaign,
  (SELECT json_agg(json_build_object('id', ic.id, 'name', ic.name)) FROM influencer_campaigns ic WHERE ic.expense_id = e.id) AS linked_campaigns`;

// ══ STATIC ROUTES (must precede /:artist) ══════════════════════════════════

// GET / — per-artist index rollup.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${ROW_COLS} FROM expenses e WHERE ${VISIBLE}`, [req.labelId]);
    const meta = (await pool.query('SELECT * FROM artist_meta WHERE label_id = $1', [req.labelId])).rows;
    const metaByKey = Object.fromEntries(meta.map(m => [m.artist_key, m]));
    const campaigns = (await pool.query('SELECT artist, planned_amount, currency, expense_id FROM influencer_campaigns WHERE label_id = $1', [req.labelId])).rows;
    const songFlags = (await pool.query(`SELECT artist_key, COUNT(*)::int AS n FROM song_campaign_status WHERE label_id = $1 AND flagged = true GROUP BY artist_key`, [req.labelId])).rows;
    const songFlagByKey = Object.fromEntries(songFlags.map(s => [s.artist_key, s.n]));

    const by = {};
    for (const r of rows) {
      if (r.not_campaign) continue; // segregated — excluded from index stats
      const k = normKey(r.artist);
      const u = await usd(r);
      const a = (by[k] ||= { key: k, names: {}, actual_total: 0, spend_count: 0, unpaid_count: 0, unpaid_total: 0, missing_socials_count: 0 });
      a.names[r.artist] = (a.names[r.artist] || 0) + 1;
      a.actual_total += u; a.spend_count++;
      if ((r.payment_status || 'Unpaid') !== 'Paid') { a.unpaid_count++; a.unpaid_total += u; }
      const socials = Array.isArray(r.social_handles) ? r.social_handles : [];
      if (!r.parent_id && socials.length === 0) a.missing_socials_count++;
    }
    for (const c of campaigns) {
      const k = normKey(c.artist);
      if (!by[k]) continue;
      const a = by[k];
      a.campaign_count = (a.campaign_count || 0) + 1;
      a.planned_total = (a.planned_total || 0) + await toUSD(c.planned_amount, c.currency);
      if (!c.expense_id) a.unlinked_campaign_count = (a.unlinked_campaign_count || 0) + 1;
    }

    const data = Object.values(by).map(a => {
      const m = metaByKey[a.key] || {};
      const display = Object.entries(a.names).sort((x, y) => y[1] - x[1])[0]?.[0] || a.key;
      return {
        artist_key: a.key, display,
        actual_total: round(a.actual_total), spend_count: a.spend_count,
        unpaid_count: a.unpaid_count, unpaid_total: round(a.unpaid_total),
        missing_socials_count: a.missing_socials_count,
        campaign_count: a.campaign_count || 0, planned_total: round(a.planned_total || 0), unlinked_campaign_count: a.unlinked_campaign_count || 0,
        flagged_songs: songFlagByKey[a.key] || 0,
        priority: m.priority || null, flagged: !!m.flagged, dismissed: !!m.dismissed,
        complete: !!m.complete, ready_for_planning: !!m.ready_for_planning,
      };
    });
    // Priority-first (High → Medium → Low → none), then total desc.
    const prank = { High: 0, Medium: 1, Low: 2 };
    data.sort((a, b) => {
      const pa = prank[a.priority] ?? 3, pb = prank[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return (b.actual_total + b.planned_total) - (a.actual_total + a.planned_total);
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Artist campaigns index error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /review-inbox — entries assigned to the current user (used by My Work).
router.get('/review-inbox', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.artist, e.song, e.amount, e.currency,
              (SELECT COUNT(*)::int FROM expense_comments c WHERE c.expense_id = e.id) AS comments
         FROM review_assignments ra JOIN expenses e ON e.id = ra.expense_id
        WHERE ra.label_id = $1 AND ra.assignee_id = $2 AND (e.deleted = false OR e.deleted IS NULL)
        ORDER BY ra.created_at DESC`,
      [req.labelId, req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /review-feed — flagged expenses + flagged songs/artists + open threads.
router.get('/review-feed', async (req, res) => {
  try {
    const flaggedRows = (await pool.query(
      `SELECT e.id, e.payee, e.artist, e.song, e.amount, e.currency, e.flag_reason,
              (SELECT json_agg(json_build_object('id', u.id, 'name', u.name)) FROM review_assignments ra JOIN users u ON u.id = ra.assignee_id WHERE ra.expense_id = e.id) AS assignees,
              (SELECT COUNT(*)::int FROM expense_comments c WHERE c.expense_id = e.id) AS comment_count
         FROM expenses e WHERE e.label_id = $1 AND e.flagged = true AND (e.deleted = false OR e.deleted IS NULL)`,
      [req.labelId]
    )).rows;
    const flaggedSongs = (await pool.query('SELECT artist_key, song_key, flag_reason FROM song_campaign_status WHERE label_id = $1 AND flagged = true', [req.labelId])).rows;
    const flaggedArtists = (await pool.query('SELECT artist_key, flag_reason FROM artist_meta WHERE label_id = $1 AND flagged = true', [req.labelId])).rows;
    const openThreads = (await pool.query(
      `SELECT e.id, e.payee, e.artist, e.song, COUNT(c.id)::int AS comment_count
         FROM expense_comments c JOIN expenses e ON e.id = c.expense_id
        WHERE c.label_id = $1 GROUP BY e.id, e.payee, e.artist, e.song ORDER BY MAX(c.created_at) DESC LIMIT 50`,
      [req.labelId]
    )).rows;
    res.json({ success: true, data: { flaggedRows, flaggedSongs, flaggedArtists, openThreads } });
  } catch (error) {
    console.error('review-feed error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /review-assign — { expense_id, user_ids[] } replace-set.
router.post('/review-assign', async (req, res) => {
  const client = await pool.connect();
  try {
    const expenseId = parseInt(req.body.expense_id, 10);
    const ids = Array.isArray(req.body.user_ids) ? req.body.user_ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    const ent = await client.query('SELECT id FROM expenses WHERE id = $1 AND label_id = $2', [expenseId, req.labelId]);
    if (!ent.rows.length) { client.release(); return res.status(404).json({ success: false, error: 'Entry not found' }); }
    await client.query('BEGIN');
    await client.query('DELETE FROM review_assignments WHERE label_id = $1 AND expense_id = $2', [req.labelId, expenseId]);
    for (const uid of ids) {
      await client.query('INSERT INTO review_assignments (label_id, expense_id, assignee_id, assigned_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [req.labelId, expenseId, uid, req.user.name]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { try { client.release(); } catch {} }
});

// ── Per-page chat rooms ────────────────────────────────────────────────────
router.get('/chat/:room', async (req, res) => {
  try {
    const room = req.params.room;
    const msgs = (await pool.query(
      `SELECT m.id, m.body, m.user_id, m.edited_at, m.deleted, m.created_at, u.name AS author
         FROM campaign_chat_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.label_id = $1 AND m.room = $2 ORDER BY m.id ASC LIMIT 500`,
      [req.labelId, room]
    )).rows;
    res.json({ success: true, data: msgs });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/chat/:room', async (req, res) => {
  try {
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Empty message' });
    const { rows } = await pool.query(
      `INSERT INTO campaign_chat_messages (label_id, room, user_id, body) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [req.labelId, req.params.room, req.user.id, body.slice(0, 4000)]
    );
    recordMentions({ labelId: req.labelId, actorId: req.user.id, body, source: 'campaign_chat', sourceId: rows[0].id, link: '/artist-campaigns' }).catch(() => {});
    res.json({ success: true, data: { id: rows[0].id, body, user_id: req.user.id, author: req.user.name, created_at: rows[0].created_at } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/chat/:room/read', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO campaign_chat_reads (label_id, room, user_id, last_read_at) VALUES ($1,$2,$3,NOW())
       ON CONFLICT (label_id, room, user_id) DO UPDATE SET last_read_at = NOW()`,
      [req.labelId, req.params.room, req.user.id]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.put('/chat/messages/:id', async (req, res) => {
  try {
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Empty' });
    const upd = await pool.query(
      `UPDATE campaign_chat_messages SET body = $1, edited_at = NOW() WHERE id = $2 AND label_id = $3 AND user_id = $4 AND deleted = false RETURNING id`,
      [body, req.params.id, req.labelId, req.user.id]
    );
    if (!upd.rows.length) return res.status(403).json({ success: false, error: 'Cannot edit' });
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.delete('/chat/messages/:id', async (req, res) => {
  try {
    const admin = isAdmin(req);
    const upd = await pool.query(
      `UPDATE campaign_chat_messages SET deleted = true, body = '' WHERE id = $1 AND label_id = $2 AND ($3 = true OR user_id = $4) RETURNING id`,
      [req.params.id, req.labelId, admin, req.user.id]
    );
    if (!upd.rows.length) return res.status(403).json({ success: false, error: 'Cannot delete' });
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Reclassification ────────────────────────────────────────────────────────
router.post('/dismiss', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO flag_dismissals (label_id, expense_id, flag_kind, created_by) VALUES ($1,$2,'artist_campaign',$3) ON CONFLICT DO NOTHING`,
      [req.labelId, parseInt(req.body.expense_id, 10), req.user.name]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/restore', async (req, res) => {
  try {
    await pool.query(`DELETE FROM flag_dismissals WHERE label_id = $1 AND expense_id = $2 AND flag_kind = 'artist_campaign'`, [req.labelId, parseInt(req.body.expense_id, 10)]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
// not-campaign toggle — cascades across the whole split family.
router.post('/not-campaign', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.body.expense_id, 10);
    const on = req.body.value !== false;
    const cur = await client.query('SELECT id, parent_id FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!cur.rows.length) { client.release(); return res.status(404).json({ success: false, error: 'Not found' }); }
    const root = cur.rows[0].parent_id || id;
    const fam = await client.query('SELECT id FROM expenses WHERE label_id = $1 AND (id = $2 OR parent_id = $2)', [req.labelId, root]);
    await client.query('BEGIN');
    for (const f of fam.rows) {
      if (on) await client.query(`INSERT INTO flag_dismissals (label_id, expense_id, flag_kind, created_by) VALUES ($1,$2,'artist_campaign_not_campaign',$3) ON CONFLICT DO NOTHING`, [req.labelId, f.id, req.user.name]);
      else await client.query(`DELETE FROM flag_dismissals WHERE label_id = $1 AND expense_id = $2 AND flag_kind = 'artist_campaign_not_campaign'`, [req.labelId, f.id]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { try { client.release(); } catch {} }
});

// ── Campaign linking ────────────────────────────────────────────────────────
router.post('/link', async (req, res) => {
  try {
    const campaignId = parseInt(req.body.campaign_id, 10);
    const expenseId = req.body.expense_id ? parseInt(req.body.expense_id, 10) : null;
    await pool.query('UPDATE influencer_campaigns SET expense_id = $1 WHERE id = $2 AND label_id = $3', [expenseId, campaignId, req.labelId]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Song status (finished / notes / flag) ────────────────────────────────────
router.post('/song-status', async (req, res) => {
  try {
    const artistKey = normKey(req.body.artist);
    const songKey = songKeyOf(req.body.song);
    const b = req.body, who = req.user.name;
    if (b.finished === undefined && b.notes === undefined && b.flagged === undefined) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }
    await pool.query('INSERT INTO song_campaign_status (label_id, artist_key, song_key) VALUES ($1,$2,$3) ON CONFLICT (label_id, artist_key, song_key) DO NOTHING', [req.labelId, artistKey, songKey]);
    if (b.finished !== undefined) await pool.query('UPDATE song_campaign_status SET finished=$1, finished_at=NOW(), finished_by=$2 WHERE label_id=$3 AND artist_key=$4 AND song_key=$5', [!!b.finished, who, req.labelId, artistKey, songKey]);
    if (b.notes !== undefined) await pool.query('UPDATE song_campaign_status SET notes=$1, notes_updated_at=NOW(), notes_updated_by=$2 WHERE label_id=$3 AND artist_key=$4 AND song_key=$5', [b.notes || null, who, req.labelId, artistKey, songKey]);
    if (b.flagged !== undefined) await pool.query('UPDATE song_campaign_status SET flagged=$1, flag_reason=$2, flagged_at=NOW(), flagged_by=$3 WHERE label_id=$4 AND artist_key=$5 AND song_key=$6', [!!b.flagged, b.flag_reason || null, who, req.labelId, artistKey, songKey]);
    res.json({ success: true });
  } catch (error) {
    console.error('song-status error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Artist meta (priority / flag / complete / ready / dismiss) ────────────────
router.post('/artist-meta', async (req, res) => {
  try {
    const key = normKey(req.body.artist);
    if (!key) return res.status(400).json({ success: false, error: 'artist required' });
    await pool.query('INSERT INTO artist_meta (label_id, artist_key) VALUES ($1,$2) ON CONFLICT (label_id, artist_key) DO NOTHING', [req.labelId, key]);
    const b = req.body, who = req.user.name;
    if (b.priority !== undefined) await pool.query('UPDATE artist_meta SET priority=$1, priority_updated_at=NOW(), priority_updated_by=$2 WHERE label_id=$3 AND artist_key=$4', [b.priority || null, who, req.labelId, key]);
    if (b.flagged !== undefined) await pool.query('UPDATE artist_meta SET flagged=$1, flag_reason=$2, flagged_at=NOW(), flagged_by=$3 WHERE label_id=$4 AND artist_key=$5', [!!b.flagged, b.flag_reason || null, who, req.labelId, key]);
    if (b.complete !== undefined) await pool.query('UPDATE artist_meta SET complete=$1, complete_at=NOW(), complete_by=$2 WHERE label_id=$3 AND artist_key=$4', [!!b.complete, who, req.labelId, key]);
    if (b.ready_for_planning !== undefined) await pool.query('UPDATE artist_meta SET ready_for_planning=$1, ready_at=NOW(), ready_by=$2 WHERE label_id=$3 AND artist_key=$4', [!!b.ready_for_planning, who, req.labelId, key]);
    if (b.dismissed !== undefined) await pool.query('UPDATE artist_meta SET dismissed=$1, dismissed_at=NOW(), dismissed_by=$2 WHERE label_id=$3 AND artist_key=$4', [!!b.dismissed, who, req.labelId, key]);
    res.json({ success: true });
  } catch (error) {
    console.error('artist-meta error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Per-expense comments (row threads) ────────────────────────────────────────
router.get('/entries/:id/comments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.body, c.author, c.created_at FROM expense_comments c WHERE c.label_id = $1 AND c.expense_id = $2 ORDER BY c.id ASC`,
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/entries/:id/comments', async (req, res) => {
  try {
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Empty comment' });
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `INSERT INTO expense_comments (label_id, expense_id, author, body, created_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING id, created_at`,
      [req.labelId, id, req.user.name, body]
    );
    recordMentions({ labelId: req.labelId, actorId: req.user.id, body, source: 'expense_comment', sourceId: id, link: '/artist-campaigns' }).catch(() => {});
    res.json({ success: true, data: { id: rows[0].id, body, author: req.user.name, created_at: rows[0].created_at } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Per-row mutations for the campaigns surface ───────────────────────────────
router.post('/entries/:id/set', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cur = await pool.query('SELECT id FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!cur.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    const b = req.body, who = req.user.name;
    const set = (col, val) => pool.query(`UPDATE expenses SET ${col} = $1 WHERE id = $2 AND label_id = $3`, [val, id, req.labelId]);
    if (b.cobrand !== undefined) await set('cobrand', !!b.cobrand);
    if (b.artist_campaign !== undefined) await set('artist_campaign', b.artist_campaign === null ? null : !!b.artist_campaign);
    if (b.is_bulk_deal !== undefined) await set('is_bulk_deal', !!b.is_bulk_deal);
    if (b.artist !== undefined) await set('artist', b.artist || null);
    if (b.song !== undefined) await set('song', b.song || null);
    if (b.category !== undefined) await set('category', b.category || null);
    if (b.payment_status !== undefined) await set('payment_status', b.payment_status);
    if (b.bulk_deal_quantity !== undefined) await set('bulk_deal_quantity', b.bulk_deal_quantity || null);
    if (b.bulk_deal_unit !== undefined) await set('bulk_deal_unit', b.bulk_deal_unit || null);
    if (b.bulk_deal_completed !== undefined) await set('bulk_deal_completed', b.bulk_deal_completed || 0);
    if (b.item_finished !== undefined) await pool.query('UPDATE expenses SET item_finished = $1, item_finished_at = NOW(), item_finished_by = $2 WHERE id = $3 AND label_id = $4', [!!b.item_finished, who, id, req.labelId]);
    if (b.flagged !== undefined) await pool.query('UPDATE expenses SET flagged = $1, flag_reason = $2, flagged_at = NOW(), flagged_by = $3 WHERE id = $4 AND label_id = $5', [!!b.flagged, b.flag_reason || null, who, id, req.labelId]);
    if (b.social_handles !== undefined) await pool.query('UPDATE expenses SET social_handles = $1::jsonb WHERE id = $2 AND label_id = $3', [JSON.stringify(b.social_handles || []), id, req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('AC entry set error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Rename song across a family ───────────────────────────────────────────────
router.post('/:artist/rename-song', async (req, res) => {
  try {
    const artistKey = normKey(req.params.artist);
    const fromKey = songKeyOf(req.body.from);
    const to = String(req.body.to || '').trim();
    if (!to) return res.status(400).json({ success: false, error: 'New song name required' });
    // Match rows for this artist whose song_key equals fromKey.
    const rows = (await pool.query(
      `SELECT id, song FROM expenses WHERE label_id = $1 AND LOWER(REGEXP_REPLACE(artist, '[^a-zA-Z0-9]', '', 'g')) = $2`,
      [req.labelId, artistKey]
    )).rows.filter(r => songKeyOf(r.song) === fromKey);
    for (const r of rows) await pool.query('UPDATE expenses SET song = $1 WHERE id = $2 AND label_id = $3', [to, r.id, req.labelId]);
    res.json({ success: true, data: { moved: rows.length } });
  } catch (error) {
    console.error('rename-song error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Export (styled XLSX) ──────────────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const scopeArtist = req.query.artist ? normKey(req.query.artist) : null;
    const scopeSong = req.query.song ? songKeyOf(req.query.song) : null;
    const rows = (await pool.query(`SELECT ${ROW_COLS} FROM expenses e WHERE ${VISIBLE}`, [req.labelId])).rows
      .filter(r => !r.not_campaign)
      .filter(r => !scopeArtist || normKey(r.artist) === scopeArtist)
      .filter(r => !scopeSong || songKeyOf(r.song) === scopeSong);
    // Group by artist → rows.
    const byArtist = {};
    for (const r of rows) { const k = normKey(r.artist); (byArtist[k] ||= { name: r.artist, rows: [] }).rows.push(r); }

    const wb = new ExcelJS.Workbook();
    const usedNames = new Set();
    const safeName = (n) => { let s = String(n || 'Artist').replace(/[\\/*?[\]:]/g, '').slice(0, 28) || 'Artist'; let x = s, i = 2; while (usedNames.has(x.toLowerCase())) x = `${s} ${i++}`.slice(0, 31); usedNames.add(x.toLowerCase()); return x; };
    for (const a of Object.values(byArtist)) {
      const ws = wb.addWorksheet(safeName(a.name));
      ws.addRow([a.name]); ws.getRow(1).font = { bold: true, size: 14 };
      const header = ['Date', 'Vendor', 'Category', 'Amount', 'Currency', 'USD', 'Status', 'Paid date', 'Rep', 'Socials', 'Invoice #', 'Campaign'];
      const hr = ws.addRow(header);
      hr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } }; });
      for (const r of a.rows) {
        const u = await usd(r);
        const socials = (Array.isArray(r.social_handles) ? r.social_handles : []).map(s => `${s.platform || ''}:${s.handle || ''}`).join(', ');
        const camp = (r.linked_campaigns || []).map(c => c.name).join(', ');
        ws.addRow([
          (r.payment_date || r.invoice_date || r.created_at || '').toString().slice(0, 10),
          r.payee, r.category, Number(r.amount || 0), r.currency, round(u),
          r.payment_status || 'Unpaid', r.payment_date ? String(r.payment_date).slice(0, 10) : '', r.rep || '', socials, r.invoice_number || '', camp,
        ]);
      }
      ws.columns.forEach(col => { col.width = 16; });
      ws.views = [{ state: 'frozen', ySplit: 2 }];
    }
    if (!Object.keys(byArtist).length) wb.addWorksheet('Empty').addRow(['No campaign spend for this scope.']);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="artist-campaigns${scopeArtist ? '-' + scopeArtist : ''}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('AC export error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// ══ ARTIST DETAIL (param route LAST) ═══════════════════════════════════════

router.get('/:artist', async (req, res) => {
  try {
    const artistKey = normKey(req.params.artist);
    const all = (await pool.query(`SELECT ${ROW_COLS} FROM expenses e WHERE ${VISIBLE}`, [req.labelId])).rows
      .filter(r => normKey(r.artist) === artistKey);
    // Non-admins never see segregated not_campaign rows.
    const rows = isAdmin(req) ? all : all.filter(r => !r.not_campaign);

    let total = 0, cobrand = 0, unpaid = 0, unpaidCount = 0;
    const byCat = {}, byCurrency = {}, cobrandBySong = {};
    const entries = [];
    for (const r of rows) {
      const u = await usd(r);
      const seg = r.not_campaign;
      const e = { ...r, amount_usd: round(u), song_key: songKeyOf(r.song) };
      entries.push(e);
      if (seg) continue; // segregated rows excluded from all stats
      total += u;
      byCat[r.category || 'Uncategorized'] = (byCat[r.category || 'Uncategorized'] || 0) + u;
      byCurrency[r.currency || 'USD'] = (byCurrency[r.currency || 'USD'] || 0) + Number(r.amount || 0);
      if ((r.payment_status || 'Unpaid') !== 'Paid') { unpaid += u; unpaidCount++; }
      if (r.cobrand) { cobrand += u; const sk = songKeyOf(r.song); cobrandBySong[sk] = (cobrandBySong[sk] || 0) + u; }
    }
    const displayName = all[0]?.artist || req.params.artist;
    const [releases, songStatus, campaigns, meta] = await Promise.all([
      pool.query('SELECT id, project_name, release_type, release_date FROM releases WHERE label_id = $1 AND artist_id IN (SELECT id FROM artists WHERE label_id = $1 AND LOWER(REGEXP_REPLACE(name, $2, \'\', \'g\')) = $3)', [req.labelId, '[^a-zA-Z0-9]', artistKey]).catch(() => ({ rows: [] })),
      pool.query('SELECT song_key, finished, notes, notes_updated_by, notes_updated_at, flagged, flag_reason FROM song_campaign_status WHERE label_id = $1 AND artist_key = $2', [req.labelId, artistKey]),
      pool.query('SELECT id, name, planned_amount, currency, expense_id, song FROM influencer_campaigns WHERE label_id = $1 AND LOWER(REGEXP_REPLACE(COALESCE(artist,\'\'), $2, \'\', \'g\')) = $3', [req.labelId, '[^a-zA-Z0-9]', artistKey]).catch(() => ({ rows: [] })),
      pool.query('SELECT * FROM artist_meta WHERE label_id = $1 AND artist_key = $2', [req.labelId, artistKey]),
    ]);
    res.json({ success: true, data: {
      artist: displayName, artist_key: artistKey,
      entries,
      totals: { spend: round(total), cobrand: round(cobrand), unpaid: round(unpaid), unpaid_count: unpaidCount, by_currency: Object.fromEntries(Object.entries(byCurrency).map(([c, v]) => [c, round(v)])) },
      categories: Object.entries(byCat).map(([category, t]) => ({ category, total: round(t) })).sort((a, b) => b.total - a.total),
      cobrand_by_song: Object.fromEntries(Object.entries(cobrandBySong).map(([s, v]) => [s, round(v)])),
      releases: releases.rows, song_status: songStatus.rows, campaigns: campaigns.rows, meta: meta.rows[0] || {},
    } });
  } catch (error) {
    console.error('Artist campaign detail error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

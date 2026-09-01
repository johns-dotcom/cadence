const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { normalizeInvoiceNum } = require('../lib/normalizeInvoiceNum');

const router = express.Router();
// Data-quality + merges are destructive — admin only, always label-scoped.
router.use(authMiddleware, withTenant, requireAdmin);

// Categories where an artist attribution is expected / where a song is expected.
const ARTIST_REQUIRED = new Set(['Recording', 'Mixing & Mastering', 'Music Video', 'Marketing', 'PR', 'Advance']);
const SONG_EXPECTED = new Set(['Recording', 'Mixing & Mastering', 'Music Video']);
const SOCIAL_EXPECTED = new Set(['Marketing', 'PR']);

const normKey = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
function levenshtein(a, b) {
  a = normKey(a); b = normKey(b);
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
const isMultiName = (s) => /,|&|\bfeat\.?\b|\bft\.?\b|\bx\b|\bvs\.?\b|\bwith\b/i.test(String(s || ''));

async function dismissedSet(labelId) {
  const { rows } = await pool.query('SELECT flag_key FROM data_quality_dismissals WHERE label_id = $1', [labelId]);
  return new Set(rows.map(r => r.flag_key));
}

// GET /api/flags — every data-quality section for this workspace.
router.get('/', async (req, res) => {
  try {
    const L = req.labelId;
    const [artists, releases, expenses, vendors, normMap, dismissed] = await Promise.all([
      pool.query('SELECT id, name FROM artists WHERE label_id = $1 ORDER BY name', [L]),
      pool.query('SELECT id, project_name, upc, isrc, spotify_uri, artist_id FROM releases WHERE label_id = $1', [L]),
      pool.query(
        `SELECT id, payee, vendor_name, artist, song, category, invoice_number, amount, currency, social_handles, invoice_date
           FROM expenses WHERE label_id = $1 AND (deleted = false OR deleted IS NULL) AND parent_id IS NULL AND (voided = false OR voided IS NULL)`,
        [L]
      ),
      pool.query('SELECT name FROM vendors WHERE label_id = $1', [L]),
      pool.query('SELECT id, pattern, base_artist FROM artist_normalization_map WHERE label_id = $1 ORDER BY pattern', [L]),
      dismissedSet(L),
    ]);
    const keep = (k) => !dismissed.has(k);
    const rosterByNorm = {};
    artists.rows.forEach(a => { rosterByNorm[normKey(a.name)] = a; });
    const mapByPattern = {};
    normMap.rows.forEach(m => { mapByPattern[normKey(m.pattern)] = m.base_artist; });

    // 1. Release dupes — shared normalized name / UPC / ISRC / Spotify URI.
    const relGroups = {};
    const addRel = (key, r) => { (relGroups[key] = relGroups[key] || []).push(r); };
    releases.rows.forEach(r => {
      if (r.project_name) addRel(`name:${normKey(r.project_name)}`, r);
      if (r.upc) addRel(`upc:${String(r.upc).trim()}`, r);
      if (r.isrc) addRel(`isrc:${String(r.isrc).trim()}`, r);
      if (r.spotify_uri) addRel(`spotify:${String(r.spotify_uri).trim()}`, r);
    });
    const seenRelPair = new Set();
    const release_dupes = [];
    for (const [gkey, items] of Object.entries(relGroups)) {
      const uniq = [...new Map(items.map(r => [r.id, r])).values()];
      if (uniq.length < 2) continue;
      const idsig = uniq.map(r => r.id).sort((a, b) => a - b).join('-');
      if (seenRelPair.has(idsig)) continue; seenRelPair.add(idsig);
      const flag_key = `reldupe:${idsig}`;
      if (!keep(flag_key)) continue;
      release_dupes.push({ flag_key, reason: gkey.split(':')[0], items: uniq.map(r => ({ id: r.id, name: r.project_name, upc: r.upc, isrc: r.isrc })) });
    }

    // 2. Artist dupes — normalized-key collisions + Levenshtein-close (≤2).
    const artByNorm = {};
    artists.rows.forEach(a => { (artByNorm[normKey(a.name)] = artByNorm[normKey(a.name)] || []).push(a); });
    const artistDupeGroups = [];
    for (const [, items] of Object.entries(artByNorm)) if (items.length > 1) artistDupeGroups.push(items);
    // Levenshtein-close pairs across distinct norm keys.
    const keys = Object.keys(artByNorm);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      if (keys[i] === keys[j]) continue;
      const d = levenshtein(keys[i], keys[j]);
      if (d > 0 && d <= 2 && Math.min(keys[i].length, keys[j].length) >= 4) artistDupeGroups.push([...artByNorm[keys[i]], ...artByNorm[keys[j]]]);
    }
    const artist_dupes = [];
    const seenArt = new Set();
    for (const items of artistDupeGroups) {
      const uniq = [...new Map(items.map(a => [a.id, a])).values()];
      if (uniq.length < 2) continue;
      const idsig = uniq.map(a => a.id).sort((a, b) => a - b).join('-');
      if (seenArt.has(idsig)) continue; seenArt.add(idsig);
      const flag_key = `artdupe:${idsig}`;
      if (!keep(flag_key)) continue;
      artist_dupes.push({ flag_key, items: uniq.map(a => ({ id: a.id, name: a.name })) });
    }

    // 3. Vendor dupes — LOWER(TRIM) variants + W9-name vs payee mismatches.
    const payeeByNorm = {};
    expenses.rows.forEach(e => { if (e.payee) (payeeByNorm[normKey(e.payee)] = payeeByNorm[normKey(e.payee)] || new Set()).add(e.payee.trim()); });
    const vendor_dupes = [];
    for (const [nk, set] of Object.entries(payeeByNorm)) {
      if (set.size < 2) continue;
      const flag_key = `vendupe:${nk}`;
      if (!keep(flag_key)) continue;
      vendor_dupes.push({ flag_key, key: nk, names: [...set] });
    }
    const vendor_w9_mismatch = [];
    vendors.rows.forEach(v => {
      if (v.w9_name && v.name && normKey(v.w9_name) !== normKey(v.name)) {
        const flag_key = `vw9:${normKey(v.name)}`;
        if (keep(flag_key)) vendor_w9_mismatch.push({ flag_key, name: v.name, w9_name: v.w9_name });
      }
    });

    // 4. Invoice dupes — normalized number per vendor, 4 severity tiers.
    const invGroups = {};
    expenses.rows.forEach(e => {
      const num = normalizeInvoiceNum(e.invoice_number);
      if (!num) return;
      const gk = `${normKey(e.payee)}::${num}`;
      (invGroups[gk] = invGroups[gk] || []).push(e);
    });
    // cross-vendor same number (low)
    const numToVendors = {};
    expenses.rows.forEach(e => { const num = normalizeInvoiceNum(e.invoice_number); if (num) (numToVendors[num] = numToVendors[num] || new Set()).add(normKey(e.payee)); });
    const invoice_dupes = [];
    for (const [gk, items] of Object.entries(invGroups)) {
      if (items.length < 2) continue;
      const flag_key = `invdupe:${gk}`;
      if (!keep(flag_key)) continue;
      const amounts = items.map(i => Number(i.amount) || 0);
      const allEqual = amounts.every(a => Math.abs(a - amounts[0]) < 0.01);
      const maxA = Math.max(...amounts), minA = Math.min(...amounts);
      const near = (maxA - minA) <= Math.max(1, maxA * 0.01);
      const severity = allEqual ? 'critical' : near ? 'high' : 'medium';
      invoice_dupes.push({ flag_key, vendor: items[0].payee, number: items[0].invoice_number, severity, items: items.map(i => ({ id: i.id, amount: i.amount, currency: i.currency, date: i.invoice_date })) });
    }
    for (const [num, vs] of Object.entries(numToVendors)) {
      if (vs.size < 2) continue;
      const flag_key = `invnum:${num}`;
      if (!keep(flag_key)) continue;
      invoice_dupes.push({ flag_key, vendor: '(multiple vendors)', number: num, severity: 'low', items: [] });
    }

    // 5. Ledger artist flags (per expense).
    const songToArtist = {};
    releases.rows.forEach(r => { if (r.project_name && r.artist_id) songToArtist[normKey(r.project_name)] = r.artist_id; });
    const artistById = {}; artists.rows.forEach(a => { artistById[a.id] = a.name; });
    const artist_flags = [];
    const pushFlag = (type, e, detail) => { const flag_key = `artflag:${type}:${e.id}`; if (keep(flag_key)) artist_flags.push({ flag_key, type, id: e.id, payee: e.payee, artist: e.artist, song: e.song, category: e.category, detail }); };
    for (const e of expenses.rows) {
      const a = (e.artist || '').trim();
      const cat = e.category || '';
      if (a) {
        const nk = normKey(a);
        if (isMultiName(a)) pushFlag('multi_name', e, 'Multiple names in one field');
        else if (mapByPattern[nk]) { /* known collab → suppressed by normalization map */ }
        else if (!rosterByNorm[nk]) pushFlag('unknown_artist', e, 'Not on the roster');
        else if (rosterByNorm[nk].name !== a) pushFlag('casing', e, `Roster spells it "${rosterByNorm[nk].name}"`);
      } else if (ARTIST_REQUIRED.has(cat)) {
        pushFlag('missing_artist', e, `${cat} entries should name an artist`);
      }
      if (a && e.song) {
        const owner = songToArtist[normKey(e.song)];
        if (owner && artistById[owner] && normKey(artistById[owner]) !== normKey(a)) pushFlag('artist_song_mismatch', e, `"${e.song}" is ${artistById[owner]}'s release`);
      }
      if (SONG_EXPECTED.has(cat) && !(e.song || '').trim()) pushFlag('missing_song', e, `${cat} entries usually name a song`);
      if (SOCIAL_EXPECTED.has(cat) && !(Array.isArray(e.social_handles) && e.social_handles.length)) pushFlag('missing_socials', e, `${cat} entries usually list socials`);
    }

    const dismissedRows = (await pool.query('SELECT flag_key, kind, note, dismissed_by, dismissed_at FROM data_quality_dismissals WHERE label_id = $1 ORDER BY dismissed_at DESC', [L])).rows;

    res.json({ success: true, data: {
      release_dupes, artist_dupes, vendor_dupes, vendor_w9_mismatch, invoice_dupes, artist_flags,
      normalization_map: normMap.rows, dismissed: dismissedRows,
      counts: { release: release_dupes.length, artist: artist_dupes.length, vendor: vendor_dupes.length + vendor_w9_mismatch.length, invoice: invoice_dupes.length, artist_flags: artist_flags.length },
    } });
  } catch (error) {
    console.error('Flags error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/flags/dismiss { flag_key, kind?, note? } — hide a flag/group.
router.post('/dismiss', async (req, res) => {
  try {
    const flag_key = String(req.body.flag_key || '').trim();
    if (!flag_key) return res.status(400).json({ success: false, error: 'flag_key required' });
    await pool.query(
      `INSERT INTO data_quality_dismissals (label_id, flag_key, kind, note, dismissed_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (label_id, flag_key) DO UPDATE SET note = EXCLUDED.note, dismissed_by = EXCLUDED.dismissed_by, dismissed_at = NOW()`,
      [req.labelId, flag_key, req.body.kind || null, req.body.note || null, req.user.name]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
// POST /api/flags/restore { flag_key }
router.post('/restore', async (req, res) => {
  try {
    await pool.query('DELETE FROM data_quality_dismissals WHERE label_id = $1 AND flag_key = $2', [req.labelId, String(req.body.flag_key || '')]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Normalization map (collab string → base artist) ─────────────────────────
// GET list is folded into GET /. Apply = store the rule + rename existing rows
// (transactional across expenses + deals) so the collab collapses everywhere.
router.post('/normalization', async (req, res) => {
  const client = await pool.connect();
  try {
    const pattern = String(req.body.pattern || '').trim();
    const base = String(req.body.base_artist || '').trim();
    // No client.release() here — the finally below releases; releasing twice
    // throws OUTSIDE the try (pg-pool double-release) and takes the process down.
    if (!pattern || !base) return res.status(400).json({ success: false, error: 'Pattern and base artist required' });
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO artist_normalization_map (label_id, pattern, base_artist, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (label_id, LOWER(pattern)) DO UPDATE SET base_artist = EXCLUDED.base_artist`,
      [req.labelId, pattern, base, req.user.name]
    );
    const ex = await client.query('UPDATE expenses SET artist = $1 WHERE LOWER(artist) = LOWER($2) AND label_id = $3', [base, pattern, req.labelId]);
    const dl = await client.query('UPDATE deals SET artist_name = $1 WHERE LOWER(artist_name) = LOWER($2) AND label_id = $3', [base, pattern, req.labelId]);
    await client.query('COMMIT');
    await logActivity(req, 'Applied artist normalization', `${pattern} → ${base}`);
    res.json({ success: true, data: { expenses: ex.rowCount, deals: dl.rowCount } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Normalization error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});
router.delete('/normalization/:id', async (req, res) => {
  try { await pool.query('DELETE FROM artist_normalization_map WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]); res.json({ success: true }); }
  catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/flags/merge-artists { source_id, target_id } — reassign everything
// the source artist owns to the target, then delete the source.
router.post('/merge-artists', async (req, res) => {
  const client = await pool.connect();
  try {
    const sourceId = parseInt(req.body.source_id, 10);
    const targetId = parseInt(req.body.target_id, 10);
    if (!sourceId || !targetId || sourceId === targetId) return res.status(400).json({ success: false, error: 'Pick two different artists' });
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, name FROM artists WHERE id = ANY($1::int[]) AND label_id = $2', [[sourceId, targetId], req.labelId]);
    if (rows.length !== 2) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Artist not found in this workspace' }); }
    const target = rows.find(r => r.id === targetId);
    const source = rows.find(r => r.id === sourceId);
    await client.query('UPDATE releases SET artist_id = $1 WHERE artist_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    await client.query('UPDATE contracts SET artist_id = $1 WHERE artist_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    await client.query('UPDATE artist_income SET artist_id = $1 WHERE artist_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    await client.query('UPDATE campaigns SET artist_id = $1 WHERE artist_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    await client.query('UPDATE artist_dev_log SET artist_id = $1 WHERE artist_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    await client.query('UPDATE expenses SET artist = $1 WHERE LOWER(artist) = LOWER($2) AND label_id = $3', [target.name, source.name, req.labelId]);
    await client.query('DELETE FROM artists WHERE id = $1 AND label_id = $2', [sourceId, req.labelId]);
    await client.query('COMMIT');
    await logActivity(req, 'Merged artists', `${source.name} → ${target.name}`);
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Merge artists error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

// POST /api/flags/merge-releases { source_id, target_id } — survivor keeps the
// UNION of filled fields, folds DSP rows, reassigns tasks, deletes the source.
router.post('/merge-releases', async (req, res) => {
  const client = await pool.connect();
  try {
    const sourceId = parseInt(req.body.source_id, 10);
    const targetId = parseInt(req.body.target_id, 10);
    if (!sourceId || !targetId || sourceId === targetId) return res.status(400).json({ success: false, error: 'Pick two different releases' });
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM releases WHERE id = ANY($1::int[]) AND label_id = $2', [[sourceId, targetId], req.labelId]);
    if (rows.length !== 2) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Release not found in this workspace' }); }
    const target = rows.find(r => r.id === targetId);
    const source = rows.find(r => r.id === sourceId);
    // Union of filled fields — target keeps its values, fills blanks from source.
    const fillable = ['upc', 'isrc', 'spotify_uri', 'artist_id', 'genre', 'release_date', 'spotify_url', 'apple_music_url', 'cover_art_url', 'notes'];
    const sets = [], vals = [];
    for (const f of fillable) {
      if (target[f] === undefined) continue;
      if ((target[f] === null || target[f] === '' ) && source[f] != null && source[f] !== '') { vals.push(source[f]); sets.push(`${f} = $${vals.length}`); }
    }
    if (sets.length) { vals.push(targetId, req.labelId); await client.query(`UPDATE releases SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND label_id = $${vals.length}`, vals); }
    await client.query(
      `UPDATE dsp_submissions s SET release_id = $1 WHERE s.release_id = $2 AND s.label_id = $3
         AND NOT EXISTS (SELECT 1 FROM dsp_submissions t WHERE t.release_id = $1 AND t.platform = s.platform)`,
      [targetId, sourceId, req.labelId]
    );
    await client.query('DELETE FROM dsp_submissions WHERE release_id = $1 AND label_id = $2', [sourceId, req.labelId]);
    await client.query('UPDATE tasks SET release_id = $1 WHERE release_id = $2 AND label_id = $3', [targetId, sourceId, req.labelId]);
    await client.query('DELETE FROM releases WHERE id = $1 AND label_id = $2', [sourceId, req.labelId]);
    await client.query('COMMIT');
    await logActivity(req, 'Merged releases', `${source.project_name} → ${target.project_name}`);
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Merge releases error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

// POST /api/flags/merge-vendors { source_name, target_name }
router.post('/merge-vendors', async (req, res) => {
  const client = await pool.connect();
  try {
    const source = (req.body.source_name || '').trim();
    const target = (req.body.target_name || '').trim();
    if (!source || !target || source.toLowerCase() === target.toLowerCase()) return res.status(400).json({ success: false, error: 'Pick two different vendor names' });
    await client.query('BEGIN');
    await client.query('UPDATE expenses SET payee = $1 WHERE LOWER(payee) = LOWER($2) AND label_id = $3', [target, source, req.labelId]);
    await client.query('UPDATE expenses SET vendor_name = $1 WHERE LOWER(vendor_name) = LOWER($2) AND label_id = $3', [target, source, req.labelId]);
    await client.query('DELETE FROM vendors WHERE LOWER(name) = LOWER($1) AND label_id = $2 AND EXISTS (SELECT 1 FROM vendors WHERE LOWER(name) = LOWER($3) AND label_id = $2)', [source, req.labelId, target]);
    await client.query('UPDATE vendors SET name = $1 WHERE LOWER(name) = LOWER($2) AND label_id = $3', [target, source, req.labelId]);
    await client.query('COMMIT');
    await logActivity(req, 'Merged vendors', `${source} → ${target}`);
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Merge vendors error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

module.exports = router;

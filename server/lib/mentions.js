const pool = require('../db');

// Parse @mentions out of comment text and persist one user_mentions row per
// matched workspace user (excluding the author). Best-effort: a failure here
// must never break the comment write, so callers should swallow errors.
//
// A handle matches a user if it equals their whitespace-stripped full name,
// their first name, or their email local-part (all case-insensitive).
async function recordMentions({ labelId, actorId, body, source, sourceId, link }) {
  if (!body) return [];
  const handles = [...new Set((String(body).match(/@([\w][\w.'-]*)/g) || []).map(h => h.slice(1).toLowerCase()))];
  if (!handles.length) return [];

  const { rows: users } = await pool.query('SELECT id, name, email FROM users WHERE label_id = $1', [labelId]);
  const targets = new Set();
  for (const u of users) {
    if (u.id === actorId) continue;
    const name = (u.name || '').toLowerCase();
    const first = name.split(/\s+/)[0];
    const flat = name.replace(/\s+/g, '');
    const local = (u.email || '').split('@')[0].toLowerCase();
    if (handles.some(h => h === flat || h === first || h === local)) targets.add(u.id);
  }

  const snippet = String(body).slice(0, 240);
  for (const uid of targets) {
    await pool.query(
      `INSERT INTO user_mentions (label_id, mentioned_user_id, actor_id, source, source_id, snippet, link)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [labelId, uid, actorId, source || null, sourceId || null, snippet, link || null]
    );
  }
  return [...targets];
}

module.exports = { recordMentions };

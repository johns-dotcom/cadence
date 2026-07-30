/**
 * Activity-stream bot — Cadence's own events, posted into chat.
 *
 * This is what a generic tool like Slack can't do natively: the things that
 * happen across the app (an invoice needs approval, a deal is signed, a release
 * lands) show up as a live feed in an #activity channel, deep-linked to the
 * record. Every workspace gets one #activity channel (like #general), and all
 * members are added to it.
 *
 * postEvent() is best-effort and self-contained: callers fire it after their
 * own write commits and never await/handle it, so a bot failure can't affect
 * the underlying action.
 */
const pool = require('../db');
const rt = require('./realtime');

// Find-or-create the per-workspace #activity channel; ensure all members are in.
async function ensureActivityChannel(labelId) {
  const found = await pool.query(
    `SELECT id FROM chat_channels WHERE label_id = $1 AND type = 'channel' AND lower(name) = 'activity' LIMIT 1`,
    [labelId]
  );
  if (found.rows[0]) return found.rows[0].id;
  const c = await pool.query(
    `INSERT INTO chat_channels (label_id, name, topic, type) VALUES ($1, 'activity', 'Automated updates from across Cadence', 'channel') RETURNING id`,
    [labelId]
  );
  const channelId = c.rows[0].id;
  await pool.query(
    `INSERT INTO chat_members (label_id, channel_id, user_id)
       SELECT $1, $2, id FROM users
        WHERE label_id = $1 AND (is_platform_admin = false OR is_platform_admin IS NULL)
     ON CONFLICT DO NOTHING`,
    [labelId, channelId]
  );
  return channelId;
}

// Post a system message to #activity. { text, icon, link }
async function postEvent(labelId, { text, icon, link } = {}) {
  try {
    if (!labelId || !text) return;
    const channelId = await ensureActivityChannel(labelId);
    const meta = { icon: icon || 'zap', link: link || null };
    const ins = await pool.query(
      `INSERT INTO chat_messages (label_id, channel_id, user_id, body, is_system, meta)
       VALUES ($1, $2, NULL, $3, true, $4) RETURNING id, created_at`,
      [labelId, channelId, String(text).slice(0, 2000), JSON.stringify(meta)]
    );
    // Shape a message payload identical to the chat route's MSG_SELECT so the
    // client renders it the same way (no author, no reactions/attachments yet).
    const msg = {
      id: ins.rows[0].id, channel_id: channelId, body: String(text).slice(0, 2000),
      user_id: null, thread_root_id: null, edited_at: null, created_at: ins.rows[0].created_at,
      is_system: true, meta, author_name: null, reply_count: 0, reactions: [], attachments: [],
    };
    rt.emitToChannel(channelId, 'message:new', msg);
  } catch (e) {
    console.error('activityBot.postEvent:', e.message);
  }
}

// Post an event to the operators' own #activity feed (the Platform HQ label),
// so platform-level happenings (new workspace, suspension) surface in operator
// chat the same way tenant events do inside a workspace.
async function postOperatorEvent({ text, icon, link } = {}) {
  try {
    const hq = await pool.query(`SELECT id FROM labels WHERE is_system = true ORDER BY id LIMIT 1`);
    const id = hq.rows[0]?.id;
    if (id) await postEvent(id, { text, icon, link });
  } catch (e) { console.error('activityBot.postOperatorEvent:', e.message); }
}

module.exports = { postEvent, postOperatorEvent, ensureActivityChannel };

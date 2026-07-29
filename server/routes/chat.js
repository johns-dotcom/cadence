const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const rt = require('../lib/realtime');

const router = express.Router();
router.use(authMiddleware, withTenant);

// ── helpers ────────────────────────────────────────────────────────────────

// Returns the caller's membership row for a channel (scoped to the tenant), or
// null. Every read/write path goes through this so a user can only touch
// channels they belong to.
async function membership(channelId, userId, labelId) {
  const { rows } = await pool.query(
    `SELECT m.*, c.type, c.name, c.is_private
       FROM chat_members m JOIN chat_channels c ON c.id = m.channel_id
      WHERE m.channel_id = $1 AND m.user_id = $2 AND m.label_id = $3`,
    [channelId, userId, labelId]
  );
  return rows[0] || null;
}

// Shape a message row with author, reactions, and thread reply count.
const MSG_SELECT = `
  SELECT m.id, m.channel_id, m.body, m.user_id, m.thread_root_id, m.edited_at, m.created_at,
         u.name AS author_name,
         (SELECT COUNT(*)::int FROM chat_messages r WHERE r.thread_root_id = m.id AND r.deleted = false) AS reply_count,
         COALESCE((
           SELECT json_agg(json_build_object('emoji', e.emoji, 'count', e.cnt, 'users', e.users))
           FROM (SELECT emoji, COUNT(*)::int cnt, json_agg(user_id) users
                   FROM chat_reactions WHERE message_id = m.id GROUP BY emoji) e
         ), '[]'::json) AS reactions
    FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id`;

async function fetchMessage(id) {
  const { rows } = await pool.query(`${MSG_SELECT} WHERE m.id = $1`, [id]);
  return rows[0] || null;
}

// ── channels ────────────────────────────────────────────────────────────────

// GET /api/chat/channels — every channel/DM the caller belongs to, with unread
// counts, last-message preview, and (for DMs) the other participants. Lazily
// ensures a #general channel exists and the caller is in it.
router.get('/channels', async (req, res) => {
  try {
    const uid = req.user.id, lid = req.labelId;

    // Ensure #general + membership (first visitor bootstraps it).
    let g = await pool.query(
      `SELECT id FROM chat_channels WHERE label_id = $1 AND type = 'channel' AND lower(name) = 'general' LIMIT 1`,
      [lid]
    );
    let generalId = g.rows[0]?.id;
    if (!generalId) {
      const c = await pool.query(
        `INSERT INTO chat_channels (label_id, name, topic, type, created_by)
         VALUES ($1, 'general', 'Company-wide chatter', 'channel', $2) RETURNING id`,
        [lid, uid]
      );
      generalId = c.rows[0].id;
    }
    await pool.query(
      `INSERT INTO chat_members (label_id, channel_id, user_id) VALUES ($1, $2, $3)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [lid, generalId, uid]
    );

    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.topic, c.type, c.is_private, c.created_by, c.created_at,
              m.last_read_at, m.muted,
              (SELECT COUNT(*)::int FROM chat_messages msg
                 WHERE msg.channel_id = c.id AND msg.deleted = false
                   AND msg.thread_root_id IS NULL
                   AND msg.created_at > m.last_read_at
                   AND (msg.user_id <> $2 OR msg.user_id IS NULL)) AS unread,
              (SELECT json_build_object('body', x.body, 'created_at', x.created_at, 'author_name', u2.name, 'deleted', x.deleted)
                 FROM chat_messages x LEFT JOIN users u2 ON u2.id = x.user_id
                WHERE x.channel_id = c.id AND x.thread_root_id IS NULL
                ORDER BY x.id DESC LIMIT 1) AS last_message
         FROM chat_members m JOIN chat_channels c ON c.id = m.channel_id
        WHERE m.label_id = $1 AND m.user_id = $2 AND c.archived = false`,
      [lid, uid]
    );

    // Attach participants (needed to label DMs + show group members).
    const ids = rows.map(r => r.id);
    let membersByChannel = {};
    if (ids.length) {
      const mem = await pool.query(
        `SELECT cm.channel_id, cm.user_id, u.name, u.email
           FROM chat_members cm JOIN users u ON u.id = cm.user_id
          WHERE cm.channel_id = ANY($1::int[])`,
        [ids]
      );
      for (const r of mem.rows) (membersByChannel[r.channel_id] ||= []).push({ id: r.user_id, name: r.name, email: r.email });
    }

    const data = rows.map(c => {
      const members = membersByChannel[c.id] || [];
      const peers = members.filter(m => m.id !== uid);
      return {
        ...c,
        members,
        // DM display name = the other participant(s).
        display_name: c.type === 'dm'
          ? (peers.map(p => p.name).join(', ') || 'You')
          : c.name,
        peer: c.type === 'dm' ? peers[0] || null : null,
      };
    });

    // Sort by most-recent activity (last message, else created).
    data.sort((a, b) => {
      const ta = new Date(a.last_message?.created_at || a.created_at).getTime();
      const tb = new Date(b.last_message?.created_at || b.created_at).getTime();
      return tb - ta;
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error('chat channels:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/chat/channels/public — joinable public channels the caller isn't in.
router.get('/channels/public', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.topic,
              (SELECT COUNT(*)::int FROM chat_members m2 WHERE m2.channel_id = c.id) AS member_count
         FROM chat_channels c
        WHERE c.label_id = $1 AND c.type = 'channel' AND c.is_private = false AND c.archived = false
          AND NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id = c.id AND m.user_id = $2)
        ORDER BY c.name`,
      [req.labelId, req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/chat/channels — create a named channel. { name, topic, is_private, member_ids }
router.post('/channels', async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, topic, is_private, member_ids } = req.body;
    const clean = String(name || '').trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
    if (!clean) return res.status(400).json({ success: false, error: 'Channel name required' });

    await client.query('BEGIN');
    const c = await client.query(
      `INSERT INTO chat_channels (label_id, name, topic, type, is_private, created_by)
       VALUES ($1, $2, $3, 'channel', $4, $5) RETURNING *`,
      [req.labelId, clean, topic || null, !!is_private, req.user.id]
    );
    const ch = c.rows[0];

    // Members = creator + any invited (validated to the same tenant).
    const set = new Set([req.user.id]);
    if (Array.isArray(member_ids)) {
      const valid = await client.query(`SELECT id FROM users WHERE label_id = $1 AND id = ANY($2::int[])`, [req.labelId, member_ids]);
      valid.rows.forEach(r => set.add(r.id));
    }
    for (const uid of set) {
      await client.query(
        `INSERT INTO chat_members (label_id, channel_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [req.labelId, ch.id, uid]
      );
    }
    await client.query('COMMIT');

    const memberIds = [...set];
    rt.addUsersToChannelRoom(ch.id, memberIds);
    memberIds.forEach(uid => rt.emitToUser(uid, 'channel:new', { id: ch.id }));
    res.json({ success: true, data: { ...ch, display_name: ch.name } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('create channel:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

// POST /api/chat/channels/:id/join — join a public channel.
router.post('/channels/:id/join', async (req, res) => {
  try {
    const ch = await pool.query(
      `SELECT * FROM chat_channels WHERE id = $1 AND label_id = $2 AND type = 'channel' AND is_private = false`,
      [req.params.id, req.labelId]
    );
    if (!ch.rows.length) return res.status(404).json({ success: false, error: 'Channel not found' });
    await pool.query(
      `INSERT INTO chat_members (label_id, channel_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.labelId, req.params.id, req.user.id]
    );
    rt.addUsersToChannelRoom(req.params.id, [req.user.id]);
    res.json({ success: true, data: { id: Number(req.params.id) } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/chat/dm — find-or-create a 1:1 DM with { user_id }.
router.post('/dm', async (req, res) => {
  const client = await pool.connect();
  try {
    const target = Number(req.body.user_id);
    if (!target || target === req.user.id) return res.status(400).json({ success: false, error: 'Invalid user' });
    const valid = await client.query(`SELECT id, name FROM users WHERE id = $1 AND label_id = $2`, [target, req.labelId]);
    if (!valid.rows.length) return res.status(404).json({ success: false, error: 'User not found' });

    // Existing DM = a 'dm' channel whose member set is exactly {me, target}.
    const existing = await client.query(
      `SELECT c.id FROM chat_channels c
        WHERE c.label_id = $1 AND c.type = 'dm'
          AND (SELECT COUNT(*) FROM chat_members m WHERE m.channel_id = c.id) = 2
          AND EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id = c.id AND m.user_id = $2)
          AND EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id = c.id AND m.user_id = $3)
        LIMIT 1`,
      [req.labelId, req.user.id, target]
    );
    if (existing.rows.length) { client.release(); return res.json({ success: true, data: { id: existing.rows[0].id } }); }

    await client.query('BEGIN');
    const c = await client.query(
      `INSERT INTO chat_channels (label_id, type, created_by) VALUES ($1, 'dm', $2) RETURNING id`,
      [req.labelId, req.user.id]
    );
    const chId = c.rows[0].id;
    for (const uid of [req.user.id, target]) {
      await client.query(`INSERT INTO chat_members (label_id, channel_id, user_id) VALUES ($1, $2, $3)`, [req.labelId, chId, uid]);
    }
    await client.query('COMMIT');
    rt.addUsersToChannelRoom(chId, [req.user.id, target]);
    [req.user.id, target].forEach(uid => rt.emitToUser(uid, 'channel:new', { id: chId }));
    res.json({ success: true, data: { id: chId } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('dm:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { try { client.release(); } catch {} }
});

// ── messages ────────────────────────────────────────────────────────────────

// GET /api/chat/channels/:id/messages?before=<id>&limit=&thread=<rootId>
router.get('/channels/:id/messages', async (req, res) => {
  try {
    const mem = await membership(req.params.id, req.user.id, req.labelId);
    if (!mem) return res.status(403).json({ success: false, error: 'Not a member' });

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const before = Number(req.query.before) || null;
    const thread = Number(req.query.thread) || null;

    const params = [req.params.id];
    let where = `m.channel_id = $1 AND m.deleted = false`;
    if (thread) { params.push(thread); where += ` AND m.thread_root_id = $${params.length}`; }
    else { where += ` AND m.thread_root_id IS NULL`; }
    if (before) { params.push(before); where += ` AND m.id < $${params.length}`; }
    params.push(limit);

    const { rows } = await pool.query(
      `${MSG_SELECT} WHERE ${where} ORDER BY m.id DESC LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, data: rows.reverse() }); // ascending for display
  } catch (err) {
    console.error('messages:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/channels/:id/messages — { body, thread_root_id }
router.post('/channels/:id/messages', async (req, res) => {
  try {
    const mem = await membership(req.params.id, req.user.id, req.labelId);
    if (!mem) return res.status(403).json({ success: false, error: 'Not a member' });
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Empty message' });
    if (body.length > 8000) return res.status(400).json({ success: false, error: 'Message too long' });

    let root = Number(req.body.thread_root_id) || null;
    if (root) {
      const r = await pool.query(`SELECT id FROM chat_messages WHERE id = $1 AND channel_id = $2`, [root, req.params.id]);
      if (!r.rows.length) root = null;
    }

    const ins = await pool.query(
      `INSERT INTO chat_messages (label_id, channel_id, user_id, body, thread_root_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.labelId, req.params.id, req.user.id, body, root]
    );
    const msg = await fetchMessage(ins.rows[0].id);

    // Sender's own read pointer advances so their own message isn't "unread".
    await pool.query(`UPDATE chat_members SET last_read_at = CURRENT_TIMESTAMP WHERE channel_id = $1 AND user_id = $2`, [req.params.id, req.user.id]);

    rt.emitToChannel(req.params.id, 'message:new', msg);
    res.json({ success: true, data: msg });
  } catch (err) {
    console.error('send message:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/chat/messages/:id — edit (author only). { body }
router.patch('/messages/:id', async (req, res) => {
  try {
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Empty message' });
    const upd = await pool.query(
      `UPDATE chat_messages SET body = $1, edited_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND label_id = $3 AND user_id = $4 AND deleted = false RETURNING channel_id`,
      [body, req.params.id, req.labelId, req.user.id]
    );
    if (!upd.rows.length) return res.status(403).json({ success: false, error: 'Cannot edit this message' });
    const msg = await fetchMessage(req.params.id);
    rt.emitToChannel(upd.rows[0].channel_id, 'message:update', msg);
    res.json({ success: true, data: msg });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// DELETE /api/chat/messages/:id — soft delete (author, or Admin/Superadmin).
router.delete('/messages/:id', async (req, res) => {
  try {
    const isAdmin = ['Superadmin', 'Admin'].includes(req.user.role);
    const upd = await pool.query(
      `UPDATE chat_messages SET deleted = true, body = ''
        WHERE id = $1 AND label_id = $2 AND ($3 = true OR user_id = $4) RETURNING channel_id`,
      [req.params.id, req.labelId, isAdmin, req.user.id]
    );
    if (!upd.rows.length) return res.status(403).json({ success: false, error: 'Cannot delete this message' });
    rt.emitToChannel(upd.rows[0].channel_id, 'message:delete', { id: Number(req.params.id), channel_id: upd.rows[0].channel_id });
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/chat/messages/:id/react — toggle an emoji reaction. { emoji }
router.post('/messages/:id/react', async (req, res) => {
  try {
    const emoji = String(req.body.emoji || '').slice(0, 16);
    if (!emoji) return res.status(400).json({ success: false, error: 'No emoji' });
    // Message must be in a channel the caller belongs to.
    const m = await pool.query(
      `SELECT msg.channel_id FROM chat_messages msg
         JOIN chat_members cm ON cm.channel_id = msg.channel_id AND cm.user_id = $2
        WHERE msg.id = $1 AND msg.label_id = $3`,
      [req.params.id, req.user.id, req.labelId]
    );
    if (!m.rows.length) return res.status(403).json({ success: false, error: 'Not allowed' });

    const del = await pool.query(
      `DELETE FROM chat_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [req.params.id, req.user.id, emoji]
    );
    if (!del.rowCount) {
      await pool.query(
        `INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [req.params.id, req.user.id, emoji]
      );
    }
    const msg = await fetchMessage(req.params.id);
    rt.emitToChannel(m.rows[0].channel_id, 'reaction:update', { id: Number(req.params.id), reactions: msg.reactions });
    res.json({ success: true, data: msg.reactions });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/chat/channels/:id/read — mark the channel read up to now.
router.post('/channels/:id/read', async (req, res) => {
  try {
    await pool.query(
      `UPDATE chat_members SET last_read_at = CURRENT_TIMESTAMP WHERE channel_id = $1 AND user_id = $2 AND label_id = $3`,
      [req.params.id, req.user.id, req.labelId]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /api/chat/unread — total unread across all the caller's channels (nav badge).
router.get('/unread', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(u.unread), 0)::int AS total
         FROM (
           SELECT (SELECT COUNT(*) FROM chat_messages msg
                     WHERE msg.channel_id = m.channel_id AND msg.deleted = false
                       AND msg.thread_root_id IS NULL AND msg.created_at > m.last_read_at
                       AND (msg.user_id <> $2 OR msg.user_id IS NULL)) AS unread
             FROM chat_members m
            WHERE m.label_id = $1 AND m.user_id = $2 AND m.muted = false
         ) u`,
      [req.labelId, req.user.id]
    );
    res.json({ success: true, data: { total: rows[0].total } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /api/chat/users — workspace roster for DM/member pickers.
router.get('/users', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role FROM users
        WHERE label_id = $1 AND (is_platform_admin = false OR is_platform_admin IS NULL)
        ORDER BY name`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

module.exports = router;

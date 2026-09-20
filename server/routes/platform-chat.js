/**
 * Cross-tenant message boards for the operator console.
 *
 * WHY THIS IS A SEPARATE ROUTER. routes/chat.js is the tenant surface: every
 * one of its queries is keyed on req.labelId, and membership() is the single
 * function that decides whether a person may read a conversation. Teaching
 * that function about operators would put a cross-tenant bypass inside the
 * security primitive every workspace user goes through. Instead the boundary
 * is crossed HERE, where the operator allowlist already lives, where every
 * read is audited, and where the tenant contract next door is untouched.
 *
 * WHAT IS VISIBLE. Public, non-archived `channel` rows only — the set any
 * member of that workspace could already join. Private channels, direct
 * messages and record-anchored threads are deliberately NOT served: the
 * console has no business reading a conversation the workspace restricted
 * internally. That exclusion is expressed once, in boardWhere(), and both the
 * listing and the per-channel guard use it.
 *
 * WHAT AN OPERATOR MAY DO. Read history, and post — as a marked operator
 * identity (chat_messages.is_operator), never as a colleague of the workspace.
 *
 * WHAT IS RECORDED. Reads and posts both land in operator_chat_audit, a
 * platform-side table. A post is self-disclosing (it shows up in the tenant's
 * channel); a read is not, which is the whole reason the table exists.
 */
const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/tenant');
const { accessibleLabelIds, scopeClause } = require('../lib/operatorAccess');
const { likeContains, LIKE_ESCAPE } = require('../lib/likePattern');
const rt = require('../lib/realtime');
const { recordMentions } = require('../lib/mentions');

const router = express.Router();

// No withTenant: this router is cross-tenant by construction, so there is no
// single req.labelId to pin it to. Every query derives its label from the
// channel being addressed and re-checks it against the operator's allowlist.
router.use(authMiddleware, requirePlatformAdmin);

// The one definition of "a workspace board". Used by the listing AND the
// per-channel guard so a channel can never be readable but unlistable (or
// worse, the reverse). `l.is_system = false` keeps Platform HQ out: those are
// the operator's OWN channels and they already have them in this same sidebar.
// A SUSPENDED workspace is deliberately still listed — its people can't log in,
// which is exactly when someone needs to look at what was said — but the
// payload carries the status so the console can say so.
const BOARD_WHERE = `
  c.type = 'channel' AND c.is_private = false AND c.archived = false
  AND l.is_system = false`;

// ── audit ──────────────────────────────────────────────────────────────────

// Views are deduped inside a window: opening a channel and paging back through
// it is one act of reading, and a row per scroll would bury the thing the log
// exists to show. Posts are never deduped — each one is a distinct act.
const VIEW_DEDUP_MS = 10 * 60 * 1000;

async function audit(req, { labelId = null, channelId = null, channelName = null, action, messageId = null, detail = null }) {
  try {
    // Dedup and insert in ONE statement. The audit write is fire-and-forget, so
    // a check-then-insert leaves a window wide enough for two in-flight
    // requests to both decide the row is missing — which is how one search
    // recorded twice. Posts skip the guard entirely: each is a distinct act.
    //
    // Every parameter in the SELECT list is CAST. A bare `$n` that also faces a
    // column in the NOT EXISTS makes Postgres deduce two types for it and raise
    // 42P08 "inconsistent types deduced for parameter" — the trap this repo has
    // now hit three times, and one that would be SILENT here, because this
    // function swallows its errors by design.
    const skipGuard = action === 'post';
    await pool.query(
      `INSERT INTO operator_chat_audit
         (operator_id, operator_email, operator_name, label_id, channel_id, channel_name, action, message_id, ip_address, detail)
       SELECT $1::int, $2::varchar, $3::varchar, $4::int, $5::int, $6::varchar, $7::varchar, $8::int, $9::varchar, $10::varchar
        WHERE $11::boolean OR NOT EXISTS (
          SELECT 1 FROM operator_chat_audit a
           WHERE a.operator_id = $1::int AND a.action = $7::varchar
             AND a.channel_id IS NOT DISTINCT FROM $5::int
             AND a.detail IS NOT DISTINCT FROM $10::varchar
             AND a.created_at > NOW() - INTERVAL '${VIEW_DEDUP_MS} milliseconds')`,
      [req.user.id, req.user.email || null, req.user.name || null, labelId, channelId,
       (channelName || '').slice(0, 120) || null, action, messageId,
       req.ip || req.headers['x-forwarded-for'] || null,
       detail ? String(detail).slice(0, 200) : null, skipGuard]
    );
  } catch (e) {
    // Best-effort, like every other audit writer here — but say so loudly,
    // because a silent audit failure is the one failure nobody notices.
    console.error('operator chat audit:', e.message);
  }
}

// ── guard ──────────────────────────────────────────────────────────────────

// Resolve :id to a board this operator may touch, or answer null. Returns the
// channel with its workspace so callers never have to look the label up again
// (and so cannot look it up differently).
async function board(req, id) {
  const channelId = parseInt(id, 10);
  if (!Number.isInteger(channelId) || channelId <= 0) return null;   // NaN → 22P02 → a 400 becomes a 500
  const params = [channelId];
  const ids = await accessibleLabelIds(req);
  const scope = scopeClause(ids, 'c.label_id', params);
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.topic, c.label_id, l.name AS workspace_name
       FROM chat_channels c JOIN labels l ON l.id = c.label_id
      WHERE c.id = $1 AND ${BOARD_WHERE}${scope}`,
    params
  );
  return rows[0] || null;
}

// ── boards ─────────────────────────────────────────────────────────────────

// GET /api/platform/chat/boards — every public channel in every workspace this
// operator may see, with the workspace that owns it. One query, not one per
// workspace: this page grows with the tenant count.
router.get('/boards', async (req, res) => {
  try {
    const params = [];
    const ids = await accessibleLabelIds(req);
    const scope = scopeClause(ids, 'c.label_id', params);
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.topic, c.label_id, c.created_at,
              l.name AS workspace_name, l.accent_color, l.console_color, l.status AS workspace_status,
              (SELECT COUNT(*)::int FROM chat_members m WHERE m.channel_id = c.id) AS member_count,
              (SELECT json_build_object('body', x.body, 'created_at', x.created_at,
                                        'author_name', u.name, 'is_system', x.is_system,
                                        'is_operator', x.is_operator)
                 FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id
                WHERE x.channel_id = c.id AND x.thread_root_id IS NULL AND x.deleted = false
                ORDER BY x.id DESC LIMIT 1) AS last_message
         FROM chat_channels c JOIN labels l ON l.id = c.label_id
        WHERE ${BOARD_WHERE}${scope}
        ORDER BY l.name, c.name`,
      params
    );

    // The full accessible roster, not just the workspaces that happen to own a
    // channel. Two reasons: a workspace with no board yet is worth SEEING (it
    // is how you notice nobody is using chat there), and the console's colour
    // assignment hands out auto slots by roster rank — resolving against a
    // subset would paint a workspace one colour here and another on /calendar.
    const rParams = [];
    const rScope = scopeClause(await accessibleLabelIds(req), 'id', rParams);
    const { rows: roster } = await pool.query(
      `SELECT id, name, status, accent_color, console_color
         FROM labels WHERE is_system = false${rScope} ORDER BY name`,
      rParams
    );

    // Group by workspace so the client renders a section per tenant rather than
    // re-deriving the grouping (and picking a different order for it).
    const byWs = new Map();
    for (const w of roster) {
      byWs.set(w.id, {
        id: w.id, name: w.name, status: w.status,
        accent_color: w.accent_color, console_color: w.console_color, channels: [],
      });
    }
    for (const r of rows) {
      if (!byWs.has(r.label_id)) {
        byWs.set(r.label_id, {
          id: r.label_id, name: r.workspace_name, status: r.workspace_status,
          accent_color: r.accent_color, console_color: r.console_color, channels: [],
        });
      }
      byWs.get(r.label_id).channels.push({
        id: r.id, name: r.name, topic: r.topic, type: 'channel',
        label_id: r.label_id, workspace_name: r.workspace_name,
        member_count: r.member_count, last_message: r.last_message,
        created_at: r.created_at, scope: 'ws',
      });
    }

    // Most-recently-active workspace first — the one with something to read.
    // Workspaces with no board at all sink to the bottom rather than vanishing.
    const data = [...byWs.values()].sort((a, b) => {
      const t = ws => Math.max(0, ...ws.channels.map(c => new Date(c.last_message?.created_at || 0).getTime()));
      return t(b) - t(a);
    });
    res.json({ success: true, data, workspaces: roster, scoped: !!ids });
  } catch (err) {
    console.error('platform boards:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/platform/chat/channels/:id/members — who is in this board.
//
// Needed for the composer's @-autocomplete to be honest: without it the
// operator's picker offers OTHER OPERATORS, and "@sarah" would resolve to
// nobody in the workspace being written to. recordMentions matches against the
// tenant's users, so the picker has to as well.
router.get('/channels/:id/members', async (req, res) => {
  try {
    const ch = await board(req, req.params.id);
    if (!ch) return res.status(404).json({ success: false, error: 'Board not found' });
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role
         FROM chat_members m JOIN users u ON u.id = m.user_id
        WHERE m.channel_id = $1 AND (u.is_platform_admin = false OR u.is_platform_admin IS NULL)
        ORDER BY u.name`,
      [ch.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('platform board members:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── messages ───────────────────────────────────────────────────────────────

const MSG_SELECT = `
  SELECT m.id, m.channel_id, m.body, m.user_id, m.thread_root_id, m.edited_at, m.created_at,
         m.is_system, m.meta, m.is_operator, m.deleted,
         u.name AS author_name,
         (SELECT COUNT(*)::int FROM chat_messages r WHERE r.thread_root_id = m.id AND r.deleted = false) AS reply_count,
         COALESCE((
           SELECT json_agg(json_build_object('emoji', e.emoji, 'count', e.cnt, 'users', e.users))
           FROM (SELECT emoji, COUNT(*)::int cnt, json_agg(user_id) users
                   FROM chat_reactions WHERE message_id = m.id GROUP BY emoji) e
         ), '[]'::json) AS reactions
    FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id`;

// GET /api/platform/chat/channels/:id/messages?before=&limit=&thread=
//
// Attachments are deliberately absent from the payload. Serving them would
// mean minting file capabilities for tenant uploads from a router whose whole
// justification is that it crosses a boundary carefully; reading the
// conversation does not require handing out the invoices in it.
router.get('/channels/:id/messages', async (req, res) => {
  try {
    const ch = await board(req, req.params.id);
    if (!ch) return res.status(404).json({ success: false, error: 'Board not found' });

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const before = Number(req.query.before) || null;
    const thread = Number(req.query.thread) || null;

    const params = [ch.id];
    let where = `m.channel_id = $1 AND m.deleted = false`;
    if (thread) { params.push(thread); where += ` AND m.thread_root_id = $${params.length}`; }
    else { where += ` AND m.thread_root_id IS NULL`; }
    if (before) { params.push(before); where += ` AND m.id < $${params.length}`; }
    params.push(limit);

    const { rows } = await pool.query(
      `${MSG_SELECT} WHERE ${where} ORDER BY m.id DESC LIMIT $${params.length}`, params
    );
    audit(req, { labelId: ch.label_id, channelId: ch.id, channelName: ch.name, action: 'view' });
    res.json({ success: true, data: rows.reverse(), channel: ch });
  } catch (err) {
    console.error('platform board messages:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/platform/chat/channels/:id/messages — { body, thread_root_id }
//
// The operator is NOT inserted into chat_members. Membership would put them in
// the workspace's own member list and roster picker, which would read as "a
// person from the platform joined our team" — and would make their read state
// a row inside the tenant. The message carries is_operator instead, so the
// tenant sees exactly one new thing: a message, marked as coming from the
// platform.
//
// Text only, no attachments: a support reply needs words, and an upload
// endpoint reachable from outside the tenant is a wider door than the feature
// asked for.
router.post('/channels/:id/messages', async (req, res) => {
  try {
    const ch = await board(req, req.params.id);
    if (!ch) return res.status(404).json({ success: false, error: 'Board not found' });

    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Empty message' });
    if (body.length > 8000) return res.status(400).json({ success: false, error: 'Message too long' });

    // A thread root must belong to THIS channel, or a reply could be planted
    // under a message in a workspace this operator cannot see.
    let root = Number(req.body.thread_root_id) || null;
    if (root) {
      const r = await pool.query(`SELECT id FROM chat_messages WHERE id = $1 AND channel_id = $2`, [root, ch.id]);
      if (!r.rows.length) root = null;
    }

    const ins = await pool.query(
      `INSERT INTO chat_messages (label_id, channel_id, user_id, body, thread_root_id, is_operator)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [ch.label_id, ch.id, req.user.id, body, root]
    );
    const { rows } = await pool.query(`${MSG_SELECT} WHERE m.id = $1`, [ins.rows[0].id]);
    const msg = { ...rows[0], attachments: [] };

    // Live to everyone in the room — the workspace's members and any other
    // operator with the board open.
    rt.emitToChannel(ch.id, 'message:new', msg);

    // @mentions resolve against the WORKSPACE's people (that is who an operator
    // would be addressing), so a tenant user gets the same bell they would from
    // a colleague. Best-effort: a mention failure must not lose the message.
    try {
      const link = `/messages/${ch.id}`;
      const named = await recordMentions({
        labelId: ch.label_id, actorId: req.user.id, body,
        source: 'chat', sourceId: ch.id, link,
      });
      named.forEach(uid => rt.emitToUser(uid, 'mention', { channelId: ch.id }));
    } catch (e) { console.error('platform chat mentions:', e.message); }

    audit(req, { labelId: ch.label_id, channelId: ch.id, channelName: ch.name, action: 'post', messageId: msg.id });
    res.json({ success: true, data: msg });
  } catch (err) {
    console.error('platform board post:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/platform/chat/search?q= — one search across every workspace board
// this operator may see.
//
// Membership cannot gate this the way the tenant search does (an operator is a
// member of nothing), so BOARD_WHERE does the gating instead — the identical
// predicate behind the listing and the per-channel guard, which is what stops
// a search from reaching a private channel or a DM that no other endpoint
// here will serve.
//
// A match is a snippet, not a visit: hits are NOT audited per channel, because
// the operator has not opened them. The search itself is recorded (with the
// words), and clicking through fires the normal 'view'. A search returning
// nothing is not recorded — it revealed nothing.
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, data: [] });
    const params = [likeContains(q)]; // see lib/likePattern
    const scope = scopeClause(await accessibleLabelIds(req), 'c.label_id', params);
    const { rows } = await pool.query(
      `SELECT m.id, m.channel_id, m.body, m.created_at, m.is_system, m.is_operator,
              u.name AS author_name,
              c.name AS channel_name, c.label_id,
              l.name AS workspace_name
         FROM chat_messages m
         JOIN chat_channels c ON c.id = m.channel_id
         JOIN labels l ON l.id = c.label_id
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.deleted = false AND m.body ILIKE $1 ${LIKE_ESCAPE} AND ${BOARD_WHERE}${scope}
        ORDER BY m.id DESC LIMIT 40`,
      params
    );
    if (rows.length) audit(req, { action: 'search', detail: q });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('platform board search:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── the log ────────────────────────────────────────────────────────────────

// GET /api/platform/chat/audit?label_id=&limit= — who has been reading.
//
// Visible to any operator who can see the workspace, not just the owner: the
// point of recording observation is that the other observers can see it. Scoped
// through the same allowlist, so this cannot become a way to learn which
// workspaces exist.
router.get('/audit', async (req, res) => {
  try {
    const params = [];
    const ids = await accessibleLabelIds(req);
    let where = `WHERE 1 = 1${scopeClause(ids, 'a.label_id', params)}`;
    // A search spans workspaces, so it carries no label_id and is deliberately
    // absent from a per-workspace log. The unfiltered call is where it shows.
    if (req.query.label_id) {
      const lid = parseInt(req.query.label_id, 10);
      if (!Number.isInteger(lid)) return res.status(400).json({ success: false, error: 'Bad workspace id' });
      params.push(lid); where += ` AND a.label_id = $${params.length}`;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT a.id, a.operator_name, a.operator_email, a.label_id, a.channel_id,
              a.channel_name, a.action, a.detail, a.created_at, l.name AS workspace_name
         FROM operator_chat_audit a LEFT JOIN labels l ON l.id = a.label_id
         ${where}
        ORDER BY a.created_at DESC, a.id DESC LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('platform chat audit read:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

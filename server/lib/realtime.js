/**
 * Realtime layer — the transport behind Cadence chat.
 *
 * A single socket.io server attaches to the Express http server. Sockets are
 * authenticated with the SAME JWT as the REST API (verified + re-checked
 * against the DB, exactly like authMiddleware), and every socket is confined
 * to its tenant: it joins `label:<id>` and `user:<id>` rooms plus a
 * `channel:<id>` room for each chat channel it belongs to.
 *
 * Delivery model is deliberately hybrid: all mutations go through the REST
 * routes (so auth, tenancy, and validation live in one place), and those
 * handlers call the exported emit* helpers to fan out the change in realtime.
 * Sockets themselves only carry ephemeral signals (presence, typing).
 */
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { canAccessLabel } = require('./operatorAccess');

let io = null;

// labelId -> Map(userId -> live socket count). Presence is per-workspace so a
// user only ever sees who's online inside their own tenant.
const presence = new Map();

function onlineUsers(labelId) {
  const m = presence.get(Number(labelId));
  return m ? [...m.keys()] : [];
}

function bumpPresence(labelId, userId, delta) {
  labelId = Number(labelId); userId = Number(userId);
  let m = presence.get(labelId);
  if (!m) { m = new Map(); presence.set(labelId, m); }
  const next = (m.get(userId) || 0) + delta;
  if (next <= 0) { m.delete(userId); return false; }   // went offline
  const wasOffline = next === 1 && delta > 0;
  m.set(userId, next);
  return wasOffline ? 'online' : true;
}

// Rooms a socket should join: its own channels (so REST broadcasts reach it).
async function channelRooms(labelId, userId) {
  try {
    const { rows } = await pool.query(
      `SELECT channel_id FROM chat_members WHERE label_id = $1 AND user_id = $2`,
      [labelId, userId]
    );
    return rows.map(r => `channel:${r.channel_id}`);
  } catch { return []; }
}

// May this identity stream a channel live?
//
//  - A workspace user: only channels they are a member of, inside their own
//    label. (Membership rows are written label-scoped, but the channel's own
//    label is re-checked rather than trusted from the join.)
//  - A platform operator: additionally, any PUBLIC, non-archived channel in a
//    workspace their allowlist admits — the same set routes/platform-chat.js
//    serves over REST, asked through the same helper so the live feed and the
//    history can never disagree about what is visible.
//
// Fails closed: any error answers no.
async function canSubscribe(user, channelId) {
  try {
    const { rows } = await pool.query(
      `SELECT c.label_id, c.type, c.is_private, c.archived,
              EXISTS (SELECT 1 FROM chat_members m
                       WHERE m.channel_id = c.id AND m.user_id = $2) AS is_member
         FROM chat_channels c WHERE c.id = $1`,
      [channelId, user.id]
    );
    const c = rows[0];
    if (!c) return false;
    if (c.is_member && Number(c.label_id) === Number(user.label_id)) return true;
    if (!user.is_platform_admin) return false;
    if (c.type !== 'channel' || c.is_private || c.archived) return false;
    return await canAccessLabel({ user }, c.label_id);
  } catch { return false; }
}

function init(server) {
  const { Server } = require('socket.io');
  io = new Server(server, {
    path: '/socket.io',
    cors: process.env.NODE_ENV !== 'production'
      ? { origin: ['http://localhost:5173', 'http://localhost:3001'], credentials: true }
      : { origin: true, credentials: true },
  });

  // Authenticate every connection against the JWT + live user row.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('No token'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.label_id || !decoded.id) return next(new Error('Malformed token'));
      const { rows } = await pool.query(
        `SELECT token_version, name, email, label_id, is_platform_admin, platform_role FROM users WHERE id = $1`,
        [decoded.id]
      );
      if (!rows.length) return next(new Error('No such user'));
      if (decoded.tv !== undefined && rows[0].token_version !== decoded.tv) return next(new Error('Stale session'));
      // Platform identity comes from the live user row, never the token: it is
      // what decides whether this socket may subscribe outside its own label.
      socket.user = {
        id: decoded.id,
        name: rows[0].name || decoded.name,
        email: rows[0].email || decoded.email,
        label_id: decoded.label_id,
        is_platform_admin: !!rows[0].is_platform_admin,
        platform_role: rows[0].platform_role || null,
      };
      next();
    } catch { next(new Error('Auth failed')); }
  });

  io.on('connection', (socket) => {
    const { id: userId, label_id: labelId } = socket.user;
    socket.join(`user:${userId}`);
    socket.join(`label:${labelId}`);

    // Presence: announce online on the first live socket for this user.
    const state = bumpPresence(labelId, userId, +1);
    if (state === 'online') io.to(`label:${labelId}`).emit('presence:update', { userId, online: true });
    // Send the newcomer the current roster.
    socket.emit('presence:list', { online: onlineUsers(labelId) });

    // EVERY socket.on() below is registered SYNCHRONOUSLY, before the awaited
    // room join further down. socket.io does not buffer an event for a
    // listener that does not exist yet, so a handler registered after an await
    // silently drops anything the client emitted in that window — and the
    // window is a database round-trip. The client subscribes the moment it
    // opens a conversation, which on a cold load beats the query every time.
    // That is why a just-opened channel could go quiet until a reload.

    // Typing relay — ephemeral, scoped to the channel room.
    socket.on('typing', ({ channelId }) => {
      if (!channelId) return;
      socket.to(`channel:${channelId}`).emit('typing', { channelId, userId, name: socket.user.name });
    });
    socket.on('typing:stop', ({ channelId }) => {
      if (!channelId) return;
      socket.to(`channel:${channelId}`).emit('typing:stop', { channelId, userId });
    });

    // Let a socket join a room the moment it joins/creates a channel, without
    // needing to reconnect (the REST route emits 'channel:new' to the user).
    //
    // This MUST be authorized. A room join is a live subscription to every
    // future message in that channel, and channel ids are global integers —
    // so an unchecked join let any authenticated user stream another tenant's
    // conversation by guessing a number. The REST layer has always enforced
    // membership; the socket layer is the same door and now asks the same
    // question.
    socket.on('channel:subscribe', async ({ channelId }) => {
      const id = Number(channelId);
      if (!Number.isInteger(id) || id <= 0) return;
      if (await canSubscribe(socket.user, id)) socket.join(`channel:${id}`);
    });

    socket.on('disconnect', () => {
      const gone = bumpPresence(labelId, userId, -1) === false;
      if (gone) io.to(`label:${labelId}`).emit('presence:update', { userId, online: false });
    });

    // Now the async part: join a room per channel this user belongs to, so the
    // REST routes' broadcasts reach them without an explicit subscribe.
    channelRooms(labelId, userId)
      .then(rooms => { for (const room of rooms) socket.join(room); })
      .catch(() => {});
  });

  return io;
}

// ── Emit helpers used by the REST routes ──────────────────────────────────
function emitToChannel(channelId, event, payload) {
  if (io) io.to(`channel:${channelId}`).emit(event, payload);
}
function emitToUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}
function emitToLabel(labelId, event, payload) {
  if (io) io.to(`label:${labelId}`).emit(event, payload);
}
// Force a set of already-connected users to join a channel room (used when a
// new channel/DM is created so members receive live messages immediately).
function addUsersToChannelRoom(channelId, userIds) {
  if (!io) return;
  for (const uid of userIds) io.to(`user:${uid}`).socketsJoin(`channel:${channelId}`);
}

function close() { if (io) io.close(); }

module.exports = { init, emitToChannel, emitToUser, emitToLabel, addUsersToChannelRoom, onlineUsers, close };

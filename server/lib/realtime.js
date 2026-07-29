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
        `SELECT token_version, name, label_id, is_platform_admin FROM users WHERE id = $1`,
        [decoded.id]
      );
      if (!rows.length) return next(new Error('No such user'));
      if (decoded.tv !== undefined && rows[0].token_version !== decoded.tv) return next(new Error('Stale session'));
      socket.user = { id: decoded.id, name: rows[0].name || decoded.name, label_id: decoded.label_id };
      next();
    } catch { next(new Error('Auth failed')); }
  });

  io.on('connection', async (socket) => {
    const { id: userId, label_id: labelId } = socket.user;
    socket.join(`user:${userId}`);
    socket.join(`label:${labelId}`);
    for (const room of await channelRooms(labelId, userId)) socket.join(room);

    // Presence: announce online on the first live socket for this user.
    const state = bumpPresence(labelId, userId, +1);
    if (state === 'online') io.to(`label:${labelId}`).emit('presence:update', { userId, online: true });
    // Send the newcomer the current roster.
    socket.emit('presence:list', { online: onlineUsers(labelId) });

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
    socket.on('channel:subscribe', ({ channelId }) => {
      if (channelId) socket.join(`channel:${channelId}`);
    });

    socket.on('disconnect', () => {
      const gone = bumpPresence(labelId, userId, -1) === false;
      if (gone) io.to(`label:${labelId}`).emit('presence:update', { userId, online: false });
    });
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

const pool = require('../db');

/**
 * Fire-and-forget activity logging helper. Writes a row scoped to the actor's
 * label so each tenant only ever sees its own audit trail. Never throws —
 * logging must not break the request it's recording.
 */
async function logActivity(req, action, detail) {
  try {
    if (!req.user?.label_id) return;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
    await pool.query(
      `INSERT INTO activity_log (label_id, user_id, action, detail, ip_address, method, endpoint, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [req.user.label_id, req.user.id, action, detail || null, ip, req.method, req.originalUrl?.split('?')[0] || null]
    );
  } catch (_) { /* swallow — logging is best-effort */ }
}

module.exports = { logActivity };

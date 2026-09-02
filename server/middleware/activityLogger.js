const pool = require('../db');

// First numeric path segment of the endpoint — `/api/ledger/1234/approve` → 1234.
// This is what makes `entry_id` free across the ~100 existing call sites: none
// of them had to be touched to start recording which record was acted on.
const ENTRY_ID_RE = /\/(\d+)(?:\/|$)/;

function entryIdFromEndpoint(endpoint) {
  const m = ENTRY_ID_RE.exec(endpoint || '');
  if (!m) return null;
  const n = parseInt(m[1], 10);
  // INT column — a path segment longer than an int would error the INSERT and
  // (silently, since we swallow) lose the log line entirely.
  return Number.isSafeInteger(n) && n <= 2147483647 ? n : null;
}

/**
 * Fire-and-forget activity logging helper. Writes a row scoped to the actor's
 * label so each tenant only ever sees its own audit trail. Never throws —
 * logging must not break the request it's recording.
 *
 * @param {object} req
 * @param {string} action  human-readable past-tense phrase ("Approved ledger entry")
 * @param {string} [detail] free text, or a JSON string of `{field:{from,to}}` diffs
 * @param {object} [opts]  { entryId, entryPayee } — payee is the human anchor the
 *                         Activity page shows under the action; only the caller
 *                         knows it, so it can't be derived like entryId can.
 */
async function logActivity(req, action, detail, opts = {}) {
  try {
    if (!req.user?.label_id) return;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
    const endpoint = req.originalUrl?.split('?')[0] || null;
    const entryId = opts.entryId != null && Number.isInteger(Number(opts.entryId))
      ? Number(opts.entryId)
      : entryIdFromEndpoint(endpoint);
    const payee = opts.entryPayee ? String(opts.entryPayee).slice(0, 255) : null;
    await pool.query(
      `INSERT INTO activity_log (label_id, user_id, action, detail, ip_address, method, endpoint, entry_id, entry_payee, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [req.user.label_id, req.user.id, action, detail || null, ip, req.method, endpoint, entryId, payee]
    );
  } catch (_) { /* swallow — logging is best-effort */ }
}

module.exports = { logActivity, entryIdFromEndpoint };

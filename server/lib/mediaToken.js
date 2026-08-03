/**
 * Signed, file-scoped, short-lived URLs for serving chat attachments to <img>
 * tags (which can't send an Authorization header).
 *
 * The old approach put the full session JWT in the image URL as ?token=, so a
 * leaked access log / Referer / browser-history entry exposed a full 16h API
 * session. Instead we hand out a capability that is (a) scoped to ONE
 * attachment id and (b) expiring, so a leak exposes read of that single file
 * for a bounded window and nothing else — the same model as S3/R2 signed URLs.
 * The signature is only ever generated for a message the requester could see.
 */
const crypto = require('crypto');

const SECRET = () => process.env.MEDIA_URL_SECRET || process.env.JWT_SECRET || '';
const DEFAULT_TTL = 24 * 3600; // seconds

function makeSig(id, exp) {
  return crypto.createHmac('sha256', SECRET()).update(`att:${id}:${exp}`).digest('base64url');
}

// Build the relative URL an <img>/download link uses. Same-origin in prod; the
// Vite dev proxy carries /api through.
function attachmentUrl(id, ttl = DEFAULT_TTL) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return `/api/chat/attachments/${id}?exp=${exp}&sig=${makeSig(id, exp)}`;
}

// Constant-time verify of an id/exp/sig triple.
function verifyAttachmentSig(id, exp, sig) {
  if (!id || !exp || !sig) return false;
  if (!/^\d+$/.test(String(exp)) || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = makeSig(id, exp);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { attachmentUrl, verifyAttachmentSig };

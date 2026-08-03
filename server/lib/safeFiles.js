/**
 * Safe serving of user-uploaded files from the app origin.
 *
 * User files carry an attacker-declared MIME type. Serving them inline with
 * that type lets an uploaded SVG/HTML run script in OUR origin (and read the
 * JWT out of localStorage). To prevent that we:
 *   - only ever render a small allowlist of inert types inline (images, PDF);
 *   - serve everything else as application/octet-stream + attachment;
 *   - always send X-Content-Type-Options: nosniff so the browser can't
 *     re-interpret the bytes as something executable.
 */
const INLINE_OK = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'application/pdf',
]);

// Sanitize a filename for a Content-Disposition header (strip quotes/CRLF).
const cleanName = (n) => String(n || 'file').replace(/["\r\n]/g, '').slice(0, 200);

// Send a Buffer with a content type + disposition that can't be turned into XSS.
function sendFileSafely(res, { mime, filename, buffer }) {
  const type = String(mime || '').toLowerCase();
  const inline = INLINE_OK.has(type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', inline ? type : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${cleanName(filename)}"`);
  res.send(buffer);
}

module.exports = { INLINE_OK, sendFileSafely, cleanName };

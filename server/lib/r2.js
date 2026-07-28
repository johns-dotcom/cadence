const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Resolve each R2 setting from any of several common env-var names, so the
// integration works regardless of exactly what the values were named.
const pick = (...names) => { for (const n of names) if (process.env[n]) return process.env[n]; return ''; };
const ACCOUNT_ID = () => pick('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID', 'R2_ACCOUNTID', 'CF_ACCOUNT_ID');
const ACCESS_KEY = () => pick('R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY', 'R2_ACCESSKEYID', 'CLOUDFLARE_R2_ACCESS_KEY_ID');
const SECRET_KEY = () => pick('R2_SECRET_ACCESS_KEY', 'R2_SECRET_KEY', 'R2_SECRETACCESSKEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY');
const bucket = () => pick('R2_BUCKET_NAME', 'R2_BUCKET', 'CLOUDFLARE_R2_BUCKET', 'R2_BUCKETNAME');
const ENDPOINT = () => pick('R2_ENDPOINT', 'R2_S3_ENDPOINT') || (ACCOUNT_ID() ? `https://${ACCOUNT_ID()}.r2.cloudflarestorage.com` : '');

// Build the S3 client lazily + memoize, so it uses whatever env is present at
// first use (and isn't constructed with empty creds at import time).
let _client = null;
function client() {
  if (_client) return _client;
  _client = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT(),
    credentials: { accessKeyId: ACCESS_KEY(), secretAccessKey: SECRET_KEY() },
  });
  return _client;
}

// All keys should be tenant-namespaced by the caller, e.g.
// `label-<labelId>/<entity>/<filename>` — keeps one label's objects from
// ever colliding with (or being enumerable from) another's.
async function uploadFile(key, buffer, mimeType) {
  await client().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }));
  return key;
}

async function getSignedFileUrl(key, expiresInSeconds = 3600) {
  return getSignedUrl(client(), new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
  }), { expiresIn: expiresInSeconds });
}

// Download an object from R2 into a Buffer. Used when we want to proxy the
// bytes through the Node server (e.g. to avoid cross-origin CORS on the
// bucket for preview fetches).
async function downloadFile(key) {
  const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return {
    buffer: Buffer.concat(chunks),
    contentType: res.ContentType || null,
  };
}

// Resolve an attachment's base64 content from either an R2 object key or a
// legacy base64 column. Callers pass both — R2 wins if its key is set.
// Returns null when neither source is populated.
async function loadFileBase64(r2Key, legacyBase64) {
  if (r2Key) {
    const { buffer } = await downloadFile(r2Key);
    return buffer.toString('base64');
  }
  return legacyBase64 || null;
}

// Same idea as loadFileBase64 but returns a raw Buffer (for archivers /
// streaming consumers that don't want to round-trip through base64).
async function loadFileBuffer(r2Key, legacyBase64) {
  if (r2Key) {
    const { buffer } = await downloadFile(r2Key);
    return buffer;
  }
  if (legacyBase64) return Buffer.from(legacyBase64, 'base64');
  return null;
}

// Delete an object from R2. Swallows "not found" so callers can use it as a
// best-effort cleanup after removing a DB row without worrying about whether
// the object still exists.
async function deleteFile(key) {
  if (!key) return;
  try {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return;
    throw err;
  }
}

// True only when endpoint + credentials + bucket all resolve. Callers fall
// back to an inline/DB path when this is false so features degrade gracefully.
function isConfigured() {
  return !!(ENDPOINT() && ACCESS_KEY() && SECRET_KEY() && bucket());
}

// Names actually detected (for a startup diagnostic — never logs values).
function configReport() {
  return { endpoint: !!ENDPOINT(), accessKey: !!ACCESS_KEY(), secretKey: !!SECRET_KEY(), bucket: !!bucket() };
}

module.exports = { uploadFile, getSignedFileUrl, downloadFile, loadFileBase64, loadFileBuffer, deleteFile, isConfigured, configReport };

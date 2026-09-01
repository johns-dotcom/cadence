// Dangerous-extension blocklist for user uploads, ported from the reference
// app's secureUpload middleware. Used where the accepted formats are too broad
// for a MIME allowlist (the admin-doc vault legitimately stores docx, txt, csv,
// …) but executables, scripts and HTML/SVG must still be refused — the latter
// two are stored-XSS vectors the moment anything serves them from our origin.
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
  '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf', '.wsc', '.wsh',
  '.ps1', '.psm1', '.psd1', '.sh', '.bash', '.csh', '.ksh',
  '.py', '.pyw', '.rb', '.pl', '.php', '.asp', '.aspx', '.jsp',
  '.dll', '.so', '.dylib', '.class', '.jar',
  '.hta', '.inf', '.reg', '.rgs', '.sct',
  '.html', '.htm', '.svg',
]);

// Trailing dots and whitespace are stripped BEFORE the extension is read:
// 'payload.html ' and 'payload.html.' both resolve to '.html' on Windows and
// would otherwise walk straight past a naive suffix check.
function blockedExtensionOf(originalname) {
  const cleaned = String(originalname || '').replace(/[.\s]+$/, '');
  const ext = '.' + (cleaned.split('.').pop() || '').toLowerCase();
  return BLOCKED_EXTENSIONS.has(ext) ? ext : null;
}

// multer fileFilter built on the blocklist.
function blocklistFileFilter(req, file, cb) {
  const bad = blockedExtensionOf(file.originalname);
  if (bad) return cb(new Error(`File type ${bad} is not allowed`), false);
  cb(null, true);
}

module.exports = { BLOCKED_EXTENSIONS, blockedExtensionOf, blocklistFileFilter };

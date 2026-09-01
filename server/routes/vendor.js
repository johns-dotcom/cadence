const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { uploadFile, getSignedFileUrl } = require('../lib/r2');
const { upsertVendor } = require('../lib/vendors');
const { normalizeInvoiceNum } = require('../lib/normalizeInvoiceNum');
const { validatePaymentFields, comparePaymentDetails, last4: payLast4 } = require('../lib/paymentFields');
const paymentCrypto = require('../lib/paymentCrypto');
const aiScan = require('../lib/aiScan');
const claude = require('../lib/claude');
const activityBot = require('../lib/activityBot');

const router = express.Router();

// PUBLIC routes — no auth. The label is identified by its unguessable
// vendor_form_token in the URL, so each workspace has its own vendor form at
// /submit/<token>. Everything created here lands as a PENDING ledger entry
// scoped to that label.

// 10 MB + an extension allowlist on a PUBLIC endpoint (boom parity — the old
// 25 MB no-filter config let a stranger park arbitrary binaries in R2).
const OK_UPLOAD = /\.(pdf|png|jpe?g|webp|gif|heic|docx?)$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (OK_UPLOAD.test(file.originalname || '')) return cb(null, true);
    const err = new Error('unsupported type');
    err.code = 'BAD_FILE_TYPE';
    cb(err);
  },
});
const fileFields = upload.fields([
  { name: 'invoice_file', maxCount: 1 },
  { name: 'w9_file', maxCount: 1 },
  { name: 'receipt_file', maxCount: 1 },
]);
// Translate multer refusals into vendor-readable 400s (a 500 tells them nothing,
// and Cloudflare swaps origin 5xx HTML in over the JSON anyway).
const wrapUpload = (mw) => (req, res, next) => mw(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'BAD_FILE_TYPE') return res.status(400).json({ success: false, error: 'That file type is not accepted — please upload a PDF, image, or Word document.' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, error: 'That file is too large — each file must be under 10 MB.' });
  console.error('[vendor] upload rejected:', err.code || '', err.message);
  return res.status(400).json({ success: false, error: 'We could not read that upload. Please check the files and try again.' });
});
const filesSafe = wrapUpload(fileFields);
const singleInvoice = wrapUpload(upload.single('invoice_file'));
const singleW9 = wrapUpload(upload.single('w9_file'));

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Resolve a label from the public URL key. Requires the unguessable
// vendor_form_token — the enumerable slug is NOT accepted (an attacker could
// guess label slugs to spam a tenant / probe via check-dup). Every label has a
// token (backfilled + defaulted in migrations); rotate it to revoke old links.
async function labelBySlug(key) {
  if (!key) return null;
  const { rows } = await pool.query(
    `SELECT id, name, slug, accent_color, logo_r2_key FROM labels WHERE vendor_form_token = $1 LIMIT 1`,
    [key]
  );
  return rows[0] || null;
}

// GET /api/vendor/:slug — public context to render the form (name + branding).
router.get('/:slug', async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const logo_url = label.logo_r2_key ? await getSignedFileUrl(label.logo_r2_key, 6 * 3600).catch(() => null) : null;
    const reps = await pool.query(`SELECT name FROM reps WHERE label_id = $1 AND active = TRUE ORDER BY LOWER(name)`, [label.id]).catch(() => ({ rows: [] }));
    // Live category vocabulary — the form is unauthenticated, so categories
    // ride the bootstrap payload instead of the (authed) /api/categories.
    const cats = await pool.query(
      `SELECT name FROM categories WHERE label_id = $1 AND kind = 'expense' AND active = TRUE ORDER BY sort_order ASC NULLS LAST, name`,
      [label.id]
    ).catch(() => ({ rows: [] }));
    res.json({
      success: true,
      data: {
        name: label.name, slug: label.slug, accent_color: label.accent_color, logo_url,
        reps: reps.rows.map(r => r.name),
        categories: cats.rows.map(r => r.name),
      },
    });
  } catch (error) {
    console.error('Vendor context error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/vendor/:slug/roster — the label's artist roster, so the form can
// offer a picker instead of free text (free-text artists fragment recoupments
// and reports keys). Cached 5 min per label — this is a public endpoint.
const rosterCache = new Map(); // labelId → { at, names }
async function labelRoster(labelId) {
  const hit = rosterCache.get(labelId);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.names;
  const { rows } = await pool.query(`SELECT name FROM artists WHERE label_id = $1 AND name IS NOT NULL ORDER BY LOWER(name)`, [labelId]);
  const names = rows.map(r => r.name);
  rosterCache.set(labelId, { at: Date.now(), names });
  return names;
}
router.get('/:slug/roster', async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    res.json({ success: true, data: await labelRoster(label.id) });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/vendor/:slug/parse-invoice — public: AI-extract fields from an
// uploaded invoice so the vendor form can auto-fill. Rate-limited; no
// persistence. Prompt carries the label's live category vocabulary + roster so
// the prefill lands on names that exist.
router.post('/:slug/parse-invoice', submitLimiter, singleInvoice, async (req, res) => {
  try {
    if (!claude.isEnabled()) return res.status(400).json({ success: false, error: 'Auto-fill is not available' });
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const cats = await pool.query(
      `SELECT name FROM categories WHERE label_id = $1 AND kind = 'expense' AND active = TRUE ORDER BY sort_order ASC NULLS LAST, name`,
      [label.id]
    ).catch(() => ({ rows: [] }));
    const roster = await labelRoster(label.id).catch(() => []);
    const r = await claude.parseInvoice({
      buffer: req.file.buffer, mimeType: req.file.mimetype,
      categories: cats.rows.map(c => c.name), roster,
    });
    if (!r.ok) return res.status(502).json({ success: false, error: 'Could not read the invoice' });
    res.json({ success: true, data: r.data });
  } catch (error) {
    console.error('Vendor parse error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/vendor/:slug/validate-w9 — pre-submit W9 sanity gate: is the form
// signed, and does the legal name match? Blocks only on a DEFINITE unsigned
// form; AI unavailable/uncertain falls open (checked:false).
router.post('/:slug/validate-w9', submitLimiter, singleW9, async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!claude.isEnabled()) return res.json({ success: true, data: { checked: false, valid: true } });
    const r = await claude.validateW9({ buffer: req.file.buffer, mimeType: req.file.mimetype, vendorName: String(req.body.vendor_name || '').trim() }).catch(() => null);
    if (!r?.ok) return res.json({ success: true, data: { checked: false, valid: true } });
    const d = r.data || {};
    res.json({
      success: true,
      data: {
        checked: true,
        valid: d.has_signature !== false,
        form_type: d.form_type, legal_name: d.legal_name,
        name_matches: d.name_matches, has_signature: d.has_signature, notes: d.notes,
      },
    });
  } catch { res.json({ success: true, data: { checked: false, valid: true } }); }
});

// Resolve a vendor name to its canonical form (walk one alias level).
async function canonicalVendor(labelId, name) {
  const { rows } = await pool.query('SELECT canonical FROM vendor_aliases WHERE label_id = $1 AND LOWER(alias) = LOWER($2) LIMIT 1', [labelId, name]);
  return rows[0]?.canonical || name;
}

// Shared by /w9-status and the submit gate so the form's badge and the submit
// requirement can never disagree (an alias-blind submit re-check used to 400
// vendors the badge had just told "you're on file").
async function w9OnFile(labelId, name) {
  const canonical = await canonicalVendor(labelId, name);
  const { rows } = await pool.query(
    `SELECT 1 FROM vendors WHERE label_id = $1 AND LOWER(name) IN (LOWER($2), LOWER($3)) AND w9_r2_key IS NOT NULL
     UNION ALL
     SELECT 1 FROM expenses WHERE label_id = $1 AND LOWER(vendor_name) IN (LOWER($2), LOWER($3))
       AND w9_r2_key IS NOT NULL AND (deleted = false OR deleted IS NULL) LIMIT 1`,
    [labelId, name, canonical]
  );
  return rows.length > 0;
}

// GET /api/vendor/:slug/w9-status?name= — does this vendor already have a W9 on
// file (so the form can skip the upload requirement)? Alias-aware.
router.get('/:slug/w9-status', async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const name = String(req.query.name || '').trim();
    if (!name) return res.json({ success: true, data: { on_file: false } });
    res.json({ success: true, data: { on_file: await w9OnFile(label.id, name) } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /api/vendor/:slug/payment-on-file?email= — do we already hold this
// vendor's payment details? CONFIRMS without DISCLOSING: method, last four, and
// the name on the account — never a decrypted value. Matched on the EMAIL,
// exactly, label-scoped: names/aliases are right for grouping invoices and
// wrong here — a name collision would show one vendor another's bank details.
router.get('/:slug/payment-on-file', async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const email = String(req.query.email || '').trim();
    if (!email || !isValidEmail(email)) return res.json({ success: true, data: { on_file: false } });
    const { rows } = await pool.query(
      `SELECT method, account_last4, holder_name, paypal_handle, account_enc, routing_enc, iban_enc, encrypted, updated_at
         FROM vendor_payment_details WHERE label_id = $1 AND LOWER(vendor_email) = LOWER($2)`,
      [label.id, email]
    );
    const r = rows[0];
    if (!r || !r.method) return res.json({ success: true, data: { on_file: false } });
    // Reusable = the stored row can be re-materialized into payable coordinates:
    // PayPal handles live in plaintext; ACH/Wire need decryptable ciphertext.
    const reusable = r.method === 'PayPal'
      ? !!r.paypal_handle
      : (paymentCrypto.isConfigured() && !!(r.account_enc || r.routing_enc || r.iban_enc));
    res.json({
      success: true,
      data: { on_file: true, method: r.method, last4: r.account_last4, holder_name: r.holder_name, reusable, updated_at: r.updated_at },
    });
  } catch (err) {
    // Degrade to "nothing on file" — the vendor is then asked to type their
    // details, which is the correct outcome when we cannot tell.
    console.error('GET /api/vendor/:slug/payment-on-file:', err.message);
    res.json({ success: true, data: { on_file: false } });
  }
});

// GET /api/vendor/:slug/lookup?email= — returning-vendor contact prefill,
// gated on the on-file email (shared-secret posture, like payment-on-file).
router.get('/:slug/lookup', async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const email = String(req.query.email || '').trim();
    if (!email || !isValidEmail(email)) return res.json({ success: true, data: { found: false } });
    const { rows } = await pool.query(
      `SELECT vendor_name, vendor_address, payment_method FROM expenses
        WHERE label_id = $1 AND LOWER(vendor_email) = LOWER($2) AND (deleted = false OR deleted IS NULL)
        ORDER BY id DESC LIMIT 1`,
      [label.id, email]
    );
    const r = rows[0];
    if (!r) return res.json({ success: true, data: { found: false } });
    res.json({ success: true, data: { found: true, vendor_name: r.vendor_name, vendor_address: r.vendor_address, payment_method: r.payment_method } });
  } catch { res.json({ success: true, data: { found: false } }); }
});

// GET /api/vendor/:slug/check-dup?email=&name=&invoice_number=&amount=&currency=
// Advisory double-entry guards (never blocking): `duplicate` compares
// NORMALIZED invoice numbers ("#003" ≡ "003" ≡ "INV-3"); `similar` is a
// same-amount, same-currency row from the last 30 days, returned WITH details
// so the vendor can actually tell whether it's the same invoice.
router.get('/:slug/check-dup', async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const email = String(req.query.email || '').trim().toLowerCase();
    const name = String(req.query.name || '').trim().toLowerCase();
    const key = normalizeInvoiceNum(req.query.invoice_number);
    const amount = parseFloat(req.query.amount) || null;
    const currency = String(req.query.currency || 'USD').trim().toUpperCase().slice(0, 6);
    if (!email && !name) return res.json({ success: true, data: { duplicate: false, similar: null } });
    const { rows } = await pool.query(
      `SELECT invoice_number, amount, currency, COALESCE(invoice_date, created_at::date) AS date, created_at
         FROM expenses
        WHERE label_id = $1 AND status != 'rejected' AND (deleted = false OR deleted IS NULL)
          AND (LOWER(vendor_email) = $2 OR LOWER(vendor_name) = $3 OR LOWER(payee) = $3)`,
      [label.id, email, name]
    );
    const duplicate = key ? rows.some(r => normalizeInvoiceNum(r.invoice_number) === key) : false;
    let similar = null;
    if (amount) {
      const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
      const hit = rows
        .filter(r => Math.abs(Number(r.amount) - amount) < 0.01
          && String(r.currency || 'USD').toUpperCase() === currency
          && new Date(r.created_at).getTime() >= cutoff)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (hit) similar = { invoice_number: hit.invoice_number, amount: hit.amount, currency: hit.currency || 'USD', date: hit.date };
    }
    res.json({ success: true, data: { duplicate, similar } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/vendor/:slug/check-invoice-number — invoice-number gate. Extracts
// the number from the uploaded file and compares (normalized) to what was
// entered. FAILS OPEN (matches:true) if AI is unavailable or errors. A document
// carrying NO number is reported (document_missing_number) so the client can
// tell the vendor to fix the document rather than guess.
router.post('/:slug/check-invoice-number', submitLimiter, singleInvoice, async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const entered = normalizeInvoiceNum(req.body.invoice_number);
    if (!entered || !req.file || !claude.isEnabled()) return res.json({ success: true, data: { matches: true, checked: false } });
    const r = await claude.parseInvoice({ buffer: req.file.buffer, mimeType: req.file.mimetype });
    if (!r.ok) return res.json({ success: true, data: { matches: true, checked: false } });
    if (r.data?.invoice_number == null) return res.json({ success: true, data: { matches: false, checked: true, document_missing_number: true } });
    const doc = normalizeInvoiceNum(r.data.invoice_number);
    res.json({ success: true, data: { matches: doc === entered, checked: true, document_number: r.data.invoice_number, parsed: r.data } });
  } catch { res.json({ success: true, data: { matches: true, checked: false } }); }
});

// POST /api/vendor/:slug/submit — create a pending ledger entry for the label.
router.post('/:slug/submit', submitLimiter, filesSafe, async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const labelId = label.id;

    const b = req.body;
    const vendorName = (b.vendor_name || '').trim();
    const vendorEmail = (b.vendor_email || '').trim();
    const vendorAddress = (b.vendor_address || '').trim();
    const category = (b.category || '').trim();
    const invoiceNum = (b.invoice_number || '').trim();
    const paymentPref = (b.payment_method || '').trim();
    const amount = parseFloat(b.amount) || null;
    const isReimb = b.is_reimbursement === 'yes' || b.is_reimbursement === 'true';
    const rep = (b.rep || '').trim();

    // Multi-artist allocation. Each named row must also name a song — a rule
    // the browser enforces too, but a check only the browser performs is a
    // request, not a requirement.
    let splits = [];
    try { splits = JSON.parse(b.splits || '[]'); } catch { splits = []; }
    if (!Array.isArray(splits)) splits = [];
    splits = splits
      .map(l => ({
        artist: String(l?.artist || '').trim(),
        song: String(l?.song || '').trim(),
        amount: parseFloat(l?.amount) || 0,
        off_roster: !!l?.off_roster,
        socials: Array.isArray(l?.socials)
          ? l.socials.map(s => ({ handle: String(s?.handle || '').trim(), amount: parseFloat(s?.amount) || 0 })).filter(s => s.handle)
          : [],
      }))
      .filter(l => l.artist)
      .slice(0, 12);

    // Structured social handles: [{ handle, amount? }] across all rows, or the
    // explicit literal "N/A" from a vendor who has none. An explicit answer
    // either way beats a blank field somebody has to chase.
    let socialHandles = splits.flatMap(l => l.socials.map(s => ({ artist: l.artist, handle: s.handle, amount: s.amount || null })));
    if (!socialHandles.length && String(b.no_socials || '') === 'true') socialHandles = [{ handle: 'N/A' }];

    // Does this label use reps? Requiring one from a tenant that configured
    // none would be a required field with no correct answer.
    const repCount = await pool.query(`SELECT COUNT(*)::int AS n FROM reps WHERE label_id = $1 AND active = TRUE`, [labelId]);
    const repsExist = (repCount.rows[0]?.n || 0) > 0;

    // Validation (server-authoritative; the client mirrors these).
    const errors = [];
    if (!vendorName) errors.push('Please enter your legal / government name.');
    if (!vendorEmail) errors.push('Please enter your email address.');
    else if (!isValidEmail(vendorEmail)) errors.push('Please enter a valid email address.');
    if (!invoiceNum) errors.push('Please enter your invoice number.');
    if (!splits.length) errors.push('Please enter at least one artist or project.');
    if (splits.some(l => !l.song)) errors.push('Please enter a song / track for every artist row.');
    if (!category) errors.push('Please select a category.');
    if (repsExist && !rep) errors.push('Please select your contact at the label.');
    if (!amount || amount <= 0) errors.push('Please enter a valid invoice amount.');
    if (!socialHandles.some(r => r.handle)) errors.push('Please add at least one social media handle, or check "no social media" (recorded as N/A).');

    // ── Payment coordinates ──────────────────────────────────────────────────
    // How we actually pay them. A returning vendor who confirmed the details we
    // already hold sends payment_reuse_on_file=true and nothing else — the
    // stored record IS the answer. Anything typed always wins over the stored
    // copy, so reuse is a fallback, never an override.
    let payFields = validatePaymentFields(paymentPref, b);
    let reusedOnFile = false;
    let storedLast4 = null;
    if (!payFields.ok && String(b.payment_reuse_on_file || '') === 'true') {
      try {
        const { rows } = await pool.query(
          `SELECT method, account_enc, routing_enc, iban_enc, paypal_handle, holder_name,
                  bank_address, account_type, bank_name, beneficiary_address, intermediary_bank,
                  wire_scope, account_last4
             FROM vendor_payment_details WHERE label_id = $1 AND LOWER(vendor_email) = LOWER($2)`,
          [labelId, vendorEmail]
        );
        const r = rows[0];
        if (r && r.method === paymentPref) {
          payFields = {
            ok: true, errors: [],
            normalized: {
              account_number: paymentCrypto.decrypt(r.account_enc) || '',
              routing_number: paymentCrypto.decrypt(r.routing_enc) || '',
              iban_swift: paymentCrypto.decrypt(r.iban_enc) || '',
              paypal: r.paypal_handle || '',
              holder_name: r.holder_name || '',
              bank_address: r.bank_address || '',
              account_type: r.account_type || '',
              bank_name: r.bank_name || '',
              beneficiary_address: r.beneficiary_address || '',
              intermediary_bank: r.intermediary_bank || '',
              wire_scope: r.wire_scope || '',
            },
          };
          reusedOnFile = true;
          storedLast4 = r.account_last4 || null;
        }
      } catch (err) {
        console.error('[vendor] could not reuse stored payment details:', err.message);
      }
    }
    errors.push(...payFields.errors);
    if (errors.length) return res.status(400).json({ success: false, error: errors[0], errors });

    // Files.
    const invoiceFile = req.files?.invoice_file?.[0];
    const w9File = req.files?.w9_file?.[0];
    const receiptFile = req.files?.receipt_file?.[0];
    if (!invoiceFile) return res.status(400).json({ success: false, error: 'Please upload your invoice file.' });
    if (isReimb && !receiptFile) return res.status(400).json({ success: false, error: 'Please attach your supporting receipt.' });
    if (!isReimb && !w9File) {
      // Alias-aware, matching /w9-status exactly — otherwise a vendor whose
      // name is a known alias sees the "on file" badge, then 400s here.
      if (!(await w9OnFile(labelId, vendorName))) {
        return res.status(400).json({ success: false, error: 'Please upload your W9 / W8 form.' });
      }
    }

    // ── Duplicate invoice numbers no longer BLOCK ────────────────────────────
    // The hard 409 that used to live here re-created the false-positive lockout
    // boom documented removing: normalizeInvoiceNum strips leading zeros and
    // collapses prefix-only numbers ("#", "INV-") to one key, so a vendor whose
    // numbering restarts each year was refused permanently, with no path in.
    // The vendor still sees the live advisory (/check-dup) before submitting;
    // a collision is flagged in notes for the approver, who is the human review
    // step anyway.
    let dupNote = '';
    try {
      const dupKey = normalizeInvoiceNum(invoiceNum);
      if (dupKey) {
        const dupRows = await pool.query(
          `SELECT invoice_number FROM expenses WHERE label_id = $1 AND status != 'rejected'
             AND (deleted = false OR deleted IS NULL)
             AND (LOWER(vendor_email) = LOWER($2) OR LOWER(vendor_name) = LOWER($3) OR LOWER(payee) = LOWER($3))`,
          [labelId, vendorEmail, vendorName]
        );
        if (dupRows.rows.some(r => normalizeInvoiceNum(r.invoice_number) === dupKey)) {
          dupNote = '⚠ Possible duplicate: an earlier entry from this vendor shares this invoice number.';
        }
      }
    } catch { /* advisory only */ }

    // Invoice-number gate — the entered number must match the document, and a
    // document with NO number at all is bounced with a fix-it instruction.
    // Fails OPEN when AI is unavailable so a scan outage never blocks a vendor.
    if (claude.isEnabled()) {
      const parsed = await claude.parseInvoice({ buffer: invoiceFile.buffer, mimeType: invoiceFile.mimetype }).catch(() => null);
      if (parsed?.ok) {
        if (parsed.data?.invoice_number == null) {
          return res.status(400).json({ success: false, error: 'The uploaded invoice does not contain an invoice number. Please add one to the document and re-upload.' });
        }
        if (normalizeInvoiceNum(parsed.data.invoice_number) !== normalizeInvoiceNum(invoiceNum)) {
          return res.status(400).json({ success: false, error: `The invoice number on your document ("${parsed.data.invoice_number}") doesn't match the number you entered ("${invoiceNum}"). Please correct one of them.` });
        }
      }
    }

    // ── Doc-vs-typed payment cross-check ─────────────────────────────────────
    // The details typed above are what we pay from; the document is
    // corroboration. Agreement is recorded, disagreement is flagged for a human
    // on Approvals, silence is fine (the form already has the details), and AI
    // being down falls open as 'unscanned'. Reimbursements are exempt — a
    // coffee-shop receipt doesn't carry the claimant's bank info.
    let paymentCheck = { method: paymentPref, typed_last4: payLast4(paymentPref, payFields.normalized), doc_last4: null, verdict: 'unscanned' };
    if (!isReimb && claude.isEnabled()) {
      const docInfo = await claude.extractPaymentInfo({ buffer: invoiceFile.buffer, mimeType: invoiceFile.mimetype }).catch(() => ({ ok: false }));
      paymentCheck = comparePaymentDetails(paymentPref, payFields.normalized, docInfo);
    } else if (isReimb) {
      paymentCheck.verdict = 'absent';
    }
    paymentCheck.checked_at = new Date().toISOString();
    if (reusedOnFile) {
      paymentCheck.reused_on_file = true;
      if (!paymentCheck.typed_last4) paymentCheck.typed_last4 = storedLast4;
    }

    // A vendor whose bank details CHANGED between invoices is the classic
    // invoice-fraud shape — recorded on the entry for the approver rather than
    // overwritten quietly.
    try {
      const { rows: prevRows } = await pool.query(
        `SELECT account_last4, method FROM vendor_payment_details WHERE label_id = $1 AND LOWER(vendor_email) = LOWER($2)`,
        [labelId, vendorEmail]
      );
      const prev = prevRows[0];
      if (prev && prev.method && !reusedOnFile && (prev.account_last4 !== paymentCheck.typed_last4 || prev.method !== paymentPref)) {
        paymentCheck.changed_from = { method: prev.method, last4: prev.account_last4 };
      }
    } catch (err) { console.error('[vendor] could not read previous payment details:', err.message); }

    // ── Artist roster normalization (server-authoritative) ──────────────────
    // Snap each split's artist to its registered casing; anything not on the
    // roster marks the entry off_roster regardless of what the client claimed.
    try {
      const roster = await labelRoster(labelId);
      const rosterMap = new Map(roster.map(n => [String(n).trim().toLowerCase(), n]));
      for (const l of splits) {
        const hit = rosterMap.get(l.artist.toLowerCase());
        if (hit) { l.artist = hit; l.off_roster = false; } else { l.off_roster = true; }
      }
    } catch { /* roster unavailable — keep client values */ }
    const offRosterArtist = splits.some(l => l.off_roster);
    const artist = splits[0].artist;
    const song = splits[0].song;

    // Store files in R2 (tenant-namespaced).
    const store = async (file, kind) => {
      if (!file) return [null, null];
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `label-${labelId}/ledger/${kind}-${Date.now()}-${safe}`;
      await uploadFile(key, file.buffer, file.mimetype);
      return [file.originalname, key];
    };
    const [invName, invKey] = await store(invoiceFile, 'invoice');
    const [w9Name, w9Key] = await store(w9File, 'w9');
    const [rcName, rcKey] = await store(receiptFile, 'receipt');

    const notes = [dupNote, (b.notes || '').trim()].filter(Boolean).join('\n') || null;
    const { rows } = await pool.query(
      `INSERT INTO expenses (
        label_id, invoice_date, payee, description, category, artist, song, invoice_number,
        amount, currency, payment_method, status, payment_status,
        payment_terms, scheduled_payment_date,
        is_reimbursement, vendor_submitted, vendor_name, vendor_email, vendor_address, vendor_bank,
        rep, notes, social_handles, off_roster_artist, payment_check, payment_last4,
        invoice_filename, invoice_r2_key, w9_filename, w9_r2_key,
        receipt_filename, receipt_r2_key, created_by, created_at
      ) VALUES (
        $1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, COALESCE($9,'USD'), $10,
        'pending', 'Unpaid', 'Net 30', (NOW() + INTERVAL '30 days')::date,
        $11, TRUE, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20::jsonb, $21,
        $22, $23, $24, $25, $26, $27, 'Vendor Submission', NOW()
      ) RETURNING id, scheduled_payment_date`,
      [
        labelId, vendorName, (b.description || '').trim() || null, category, artist, song || null, invoiceNum,
        amount, (b.currency || 'USD').trim(), paymentPref,
        isReimb, vendorName, vendorEmail, vendorAddress || null,
        payFields.normalized.bank_name || null,
        rep || null, notes,
        socialHandles.length ? JSON.stringify(socialHandles) : null,
        offRosterArtist, JSON.stringify(paymentCheck), paymentCheck.typed_last4,
        invName, invKey, w9Name, w9Key, rcName, rcKey,
      ]
    );
    const entryId = rows[0].id;
    const scheduledDate = rows[0].scheduled_payment_date;

    // ── Remember, so the next invoice does not ask again ─────────────────────
    // Sensitive values (account/routing/IBAN) are AES-256-GCM ciphertext when
    // PAYMENT_DETAILS_KEY is configured. With NO key the vault degrades: method
    // + last4 + non-sensitive names only, flagged encrypted=FALSE — full
    // numbers are NEVER written unencrypted. Best-effort: the invoice is
    // already in the ledger and the details are still on the document we hold.
    try {
      const n = payFields.normalized;
      if (reusedOnFile) {
        await pool.query(
          `UPDATE vendor_payment_details SET updated_from_entry_id = $1, updated_at = NOW()
            WHERE label_id = $2 AND LOWER(vendor_email) = LOWER($3)`,
          [entryId, labelId, vendorEmail]
        );
      } else {
        const canEncrypt = paymentCrypto.isConfigured();
        await pool.query(`
          INSERT INTO vendor_payment_details
            (label_id, vendor_email, vendor_name, method, account_enc, routing_enc, iban_enc,
             paypal_handle, account_last4, holder_name, bank_address, account_type,
             bank_name, beneficiary_address, intermediary_bank, wire_scope,
             encrypted, updated_from_entry_id, updated_at)
          VALUES ($1, LOWER($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
          ON CONFLICT (label_id, LOWER(vendor_email)) DO UPDATE SET
            vendor_name = EXCLUDED.vendor_name, method = EXCLUDED.method,
            account_enc = EXCLUDED.account_enc, routing_enc = EXCLUDED.routing_enc,
            iban_enc = EXCLUDED.iban_enc, paypal_handle = EXCLUDED.paypal_handle,
            account_last4 = EXCLUDED.account_last4, holder_name = EXCLUDED.holder_name,
            bank_address = EXCLUDED.bank_address, account_type = EXCLUDED.account_type,
            bank_name = EXCLUDED.bank_name,
            beneficiary_address = EXCLUDED.beneficiary_address,
            intermediary_bank = EXCLUDED.intermediary_bank,
            wire_scope = EXCLUDED.wire_scope, encrypted = EXCLUDED.encrypted,
            updated_from_entry_id = EXCLUDED.updated_from_entry_id, updated_at = NOW()`,
          [labelId, vendorEmail, vendorName, paymentPref,
            canEncrypt && n.account_number ? paymentCrypto.encrypt(n.account_number) : null,
            canEncrypt && n.routing_number ? paymentCrypto.encrypt(n.routing_number) : null,
            canEncrypt && n.iban_swift ? paymentCrypto.encrypt(n.iban_swift) : null,
            n.paypal || null, paymentCheck.typed_last4, n.holder_name || null,
            n.bank_address || null, n.account_type || null, n.bank_name || null,
            n.beneficiary_address || null, n.intermediary_bank || null,
            n.wire_scope || null, canEncrypt, entryId]
        );
        if (!canEncrypt) {
          console.error('[vendor] PAYMENT_DETAILS_KEY is not configured — stored method + last4 only for this submission. Set the key; see lib/paymentCrypto.js.');
        }
      }
    } catch (err) {
      console.error('[vendor] could not store vendor payment details:', err.message);
    }

    // Multi-artist allocation breakdown (artists + per-line socials/amounts),
    // stored for the bookkeeper to review and apply as splits.
    if (splits.length) {
      await pool.query('UPDATE expenses SET artist_breakdown = $1::jsonb WHERE id = $2 AND label_id = $3',
        [JSON.stringify(splits), entryId, labelId]).catch(() => {});
    }

    // Keep the vendor record current (contact + W9 for next time). Bank details
    // deliberately NOT written here any more — they live in the encrypted vault.
    upsertVendor(pool, labelId, {
      name: vendorName, email: vendorEmail, address: vendorAddress,
      w9_r2_key: w9Key, w9_filename: w9Name,
    }).catch(() => {});

    // Save up to 4 extra emails against the vendor (auto-CC'd on confirmations),
    // under the CANONICAL name when the submitted name is a known alias — so
    // they surface on the vendor the rest of the app shows.
    let extra = [];
    try { extra = JSON.parse(b.extra_emails || '[]'); } catch { extra = String(b.extra_emails || '').split(/[,;]/); }
    const canonicalName = await canonicalVendor(labelId, vendorName).catch(() => vendorName);
    for (const raw of (Array.isArray(extra) ? extra : []).slice(0, 4)) {
      const em = String(raw || '').trim();
      if (em && isValidEmail(em) && em.toLowerCase() !== vendorEmail.toLowerCase()) {
        pool.query(
          `INSERT INTO vendor_emails (label_id, vendor, email, created_by) VALUES ($1,$2,$3,'Vendor form')
           ON CONFLICT (label_id, LOWER(vendor), LOWER(email)) DO NOTHING`,
          [labelId, canonicalName, em]
        ).catch(() => {});
      }
    }

    // Background AI discrepancy scans (fire-and-forget; no key = graceful no-op).
    if (claude.isEnabled()) {
      aiScan.rescanInvoice(labelId, entryId).catch(() => {});
      if (w9Key) aiScan.rescanW9(labelId, entryId).catch(() => {});
    }

    // Audit it in the label's activity feed.
    pool.query(
      `INSERT INTO activity_log (label_id, action, detail, method, endpoint, created_at)
       VALUES ($1, 'Vendor submission received', $2, 'POST', $3, NOW())`,
      [labelId, `${vendorName} — ${invoiceNum}`, `/api/vendor/${label.slug}/submit`]
    ).catch(() => {});

    // Activity-stream: a vendor invoice landed and needs approval.
    activityBot.postEvent(labelId, {
      text: `🧾 New invoice from *${vendorName}* · ${(b.currency || 'USD')} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} — needs approval${paymentCheck.verdict === 'mismatch' ? ' · payment details differ from the document' : ''}${paymentCheck.changed_from ? ' · bank details changed' : ''}`,
      icon: 'receipt', link: '/approvals',
    });

    res.status(201).json({
      success: true,
      data: { id: entryId, payment_terms: 'Net 30', scheduled_payment_date: scheduledDate },
    });
  } catch (error) {
    console.error('Vendor submit error:', error);
    res.status(500).json({ success: false, error: 'Submission failed. Please try again.' });
  }
});

module.exports = router;

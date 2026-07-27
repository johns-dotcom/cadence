const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { uploadFile, getSignedFileUrl } = require('../lib/r2');
const { upsertVendor } = require('../lib/vendors');
const { normalizeInvoiceNum } = require('../lib/normalizeInvoiceNum');
const aiScan = require('../lib/aiScan');
const claude = require('../lib/claude');

const router = express.Router();

// PUBLIC routes — no auth. The label is identified by its slug in the URL, so
// each workspace has its own vendor form at /submit/<slug>. Everything created
// here lands as a PENDING ledger entry scoped to that label.

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const fileFields = upload.fields([
  { name: 'invoice_file', maxCount: 1 },
  { name: 'w9_file', maxCount: 1 },
  { name: 'receipt_file', maxCount: 1 },
]);

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Resolve a label from the public URL key. Accepts the unguessable
// vendor_form_token (preferred) OR the legacy slug so old links keep working.
async function labelBySlug(key) {
  const { rows } = await pool.query(
    `SELECT id, name, slug, accent_color, logo_r2_key FROM labels
       WHERE vendor_form_token = $1 OR slug = $1
       ORDER BY (vendor_form_token = $1) DESC LIMIT 1`,
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
    res.json({
      success: true,
      data: { name: label.name, slug: label.slug, accent_color: label.accent_color, logo_url, reps: reps.rows.map(r => r.name) },
    });
  } catch (error) {
    console.error('Vendor context error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/vendor/:slug/parse-invoice — public: AI-extract fields from an
// uploaded invoice so the vendor form can auto-fill. Rate-limited; no persistence.
router.post('/:slug/parse-invoice', submitLimiter, upload.single('invoice_file'), async (req, res) => {
  try {
    if (!claude.isEnabled()) return res.status(400).json({ success: false, error: 'Auto-fill is not available' });
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const r = await claude.parseInvoice({ buffer: req.file.buffer, mimeType: req.file.mimetype });
    if (!r.ok) return res.status(502).json({ success: false, error: 'Could not read the invoice' });
    res.json({ success: true, data: r.data });
  } catch (error) {
    console.error('Vendor parse error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Resolve a vendor name to its canonical form (walk one alias level).
async function canonicalVendor(labelId, name) {
  const { rows } = await pool.query('SELECT canonical FROM vendor_aliases WHERE label_id = $1 AND LOWER(alias) = LOWER($2) LIMIT 1', [labelId, name]);
  return rows[0]?.canonical || name;
}

// GET /api/vendor/:slug/w9-status?name= — does this vendor already have a W9 on
// file (so the form can skip the upload requirement)? Alias-aware.
router.get('/:slug/w9-status', async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const name = String(req.query.name || '').trim();
    if (!name) return res.json({ success: true, data: { on_file: false } });
    const canonical = await canonicalVendor(label.id, name);
    const { rows } = await pool.query(
      `SELECT 1 FROM vendors WHERE label_id = $1 AND LOWER(name) IN (LOWER($2), LOWER($3)) AND w9_r2_key IS NOT NULL
       UNION ALL
       SELECT 1 FROM expenses WHERE label_id = $1 AND LOWER(vendor_name) IN (LOWER($2), LOWER($3))
         AND w9_r2_key IS NOT NULL AND (deleted = false OR deleted IS NULL) LIMIT 1`,
      [label.id, name, canonical]
    );
    res.json({ success: true, data: { on_file: rows.length > 0 } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /api/vendor/:slug/check-dup?email=&name=&invoice_number=&amount= — warn on
// a likely duplicate (normalized invoice# against this vendor's email OR name)
// or a same-amount near-duplicate.
router.get('/:slug/check-dup', async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const email = String(req.query.email || '').trim().toLowerCase();
    const name = String(req.query.name || '').trim().toLowerCase();
    const key = normalizeInvoiceNum(req.query.invoice_number);
    const amount = parseFloat(req.query.amount) || null;
    if (!email && !name) return res.json({ success: true, data: { duplicate: false, similar: false } });
    const { rows } = await pool.query(
      `SELECT invoice_number, amount, invoice_date FROM expenses
        WHERE label_id = $1 AND status != 'rejected' AND (deleted = false OR deleted IS NULL)
          AND (LOWER(vendor_email) = $2 OR LOWER(vendor_name) = $3)`,
      [label.id, email, name]
    );
    const duplicate = key ? rows.some(r => normalizeInvoiceNum(r.invoice_number) === key) : false;
    const similar = amount ? rows.some(r => Math.abs(Number(r.amount) - amount) < 0.01) : false;
    res.json({ success: true, data: { duplicate, similar } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/vendor/:slug/check-invoice-number — invoice-number gate. Extracts
// the number from the uploaded file and compares (normalized) to what was
// entered. FAILS OPEN (matches:true) if AI is unavailable or errors.
router.post('/:slug/check-invoice-number', submitLimiter, upload.single('invoice_file'), async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const entered = normalizeInvoiceNum(req.body.invoice_number);
    if (!entered || !req.file || !claude.isEnabled()) return res.json({ success: true, data: { matches: true, checked: false } });
    const r = await claude.parseInvoice({ buffer: req.file.buffer, mimeType: req.file.mimetype });
    if (!r.ok || r.data?.invoice_number == null) return res.json({ success: true, data: { matches: true, checked: false } });
    const doc = normalizeInvoiceNum(r.data.invoice_number);
    res.json({ success: true, data: { matches: doc === entered, checked: true, document_number: r.data.invoice_number } });
  } catch { res.json({ success: true, data: { matches: true, checked: false } }); }
});

// POST /api/vendor/:slug/submit — create a pending ledger entry for the label.
router.post('/:slug/submit', submitLimiter, fileFields, async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const labelId = label.id;

    const b = req.body;
    const vendorName = (b.vendor_name || '').trim();
    const vendorEmail = (b.vendor_email || '').trim();
    const vendorAddress = (b.vendor_address || '').trim();
    const vendorBank = (b.vendor_bank || '').trim();
    const artist = (b.artist || '').trim();
    const category = (b.category || '').trim();
    const invoiceNum = (b.invoice_number || '').trim();
    const paymentPref = (b.payment_method || '').trim();
    const amount = parseFloat(b.amount) || null;
    const isReimb = b.is_reimbursement === 'yes' || b.is_reimbursement === 'true';

    // Validation (mirrors the Boom public form's required set).
    const errors = [];
    if (!vendorName) errors.push('Please enter your legal / government name.');
    if (!vendorEmail) errors.push('Please enter your email address.');
    else if (!isValidEmail(vendorEmail)) errors.push('Please enter a valid email address.');
    if (!vendorAddress) errors.push('Please enter your mailing address.');
    if (!vendorBank) errors.push('Please enter your bank name.');
    if (!invoiceNum) errors.push('Please enter your invoice number.');
    if (!paymentPref) errors.push('Please select your preferred payment method.');
    if (!artist) errors.push('Please enter the artist or project name.');
    if (!category) errors.push('Please select a category.');
    if (!amount || amount <= 0) errors.push('Please enter a valid invoice amount.');
    if (errors.length) return res.status(400).json({ success: false, error: errors[0] });

    const invoiceFile = req.files?.invoice_file?.[0];
    const w9File = req.files?.w9_file?.[0];
    const receiptFile = req.files?.receipt_file?.[0];
    if (!invoiceFile) return res.status(400).json({ success: false, error: 'Please upload your invoice file.' });
    if (isReimb && !receiptFile) return res.status(400).json({ success: false, error: 'Please attach your supporting receipt.' });
    if (!isReimb && !w9File) {
      // Accept a W9 already on file — either on the vendor record or any prior
      // approved invoice for this vendor in this label.
      const { rows } = await pool.query(
        `SELECT 1 FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2) AND w9_r2_key IS NOT NULL
         UNION ALL
         SELECT 1 FROM expenses WHERE label_id = $1 AND LOWER(vendor_name) = LOWER($2)
           AND w9_r2_key IS NOT NULL AND (deleted = false OR deleted IS NULL) LIMIT 1`,
        [labelId, vendorName]
      );
      if (!rows.length) return res.status(400).json({ success: false, error: 'Please upload your W9 / W8 form.' });
    }

    // Duplicate guard — normalized invoice number against this vendor's email
    // OR name (so "INV-0012" and "12" collide).
    const dupKey = normalizeInvoiceNum(invoiceNum);
    const dupRows = await pool.query(
      `SELECT invoice_number FROM expenses WHERE label_id = $1 AND status != 'rejected'
         AND (deleted = false OR deleted IS NULL)
         AND (LOWER(vendor_email) = LOWER($2) OR LOWER(vendor_name) = LOWER($3))`,
      [labelId, vendorEmail, vendorName]
    );
    if (dupKey && dupRows.rows.some(r => normalizeInvoiceNum(r.invoice_number) === dupKey)) {
      return res.status(409).json({ success: false, error: 'We already have a submission from you with that invoice number.' });
    }

    // Invoice-number gate — the entered number must match the document. Fails
    // OPEN when AI is unavailable so a scan outage never blocks a real vendor.
    if (claude.isEnabled()) {
      const parsed = await claude.parseInvoice({ buffer: invoiceFile.buffer, mimeType: invoiceFile.mimetype }).catch(() => null);
      const docNum = parsed?.ok ? parsed.data?.invoice_number : null;
      if (docNum != null && normalizeInvoiceNum(docNum) !== dupKey) {
        return res.status(400).json({ success: false, error: `The invoice number you entered (${invoiceNum}) doesn't match the document (${docNum}). Please correct it.` });
      }
    }

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

    const { rows } = await pool.query(
      `INSERT INTO expenses (
        label_id, invoice_date, payee, description, category, artist, invoice_number,
        amount, currency, payment_method, status, payment_status,
        is_reimbursement, vendor_submitted, vendor_name, vendor_email, vendor_address, vendor_bank,
        rep, notes, invoice_filename, invoice_r2_key, w9_filename, w9_r2_key,
        receipt_filename, receipt_r2_key, created_by, created_at
      ) VALUES (
        $1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, COALESCE($8,'USD'), $9,
        'pending', 'Unpaid', $10, TRUE, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, 'Vendor Submission', NOW()
      ) RETURNING id`,
      [
        labelId, vendorName, (b.notes || '').trim() || null, category, artist, invoiceNum,
        amount, (b.currency || 'USD').trim(), paymentPref, isReimb,
        vendorName, vendorEmail, vendorAddress, vendorBank, (b.rep || '').trim() || null,
        (b.notes || '').trim() || null, invName, invKey, w9Name, w9Key, rcName, rcKey,
      ]
    );

    // Song + socials (not in the base insert positional list).
    const song = (b.song || '').trim();
    const socials = (b.socials || '').trim();
    if (song || socials) {
      pool.query(
        `UPDATE expenses SET song = COALESCE(NULLIF($1,''), song),
           notes = TRIM(COALESCE(notes,'') || CASE WHEN $2 <> '' THEN E'\nSocials: ' || $2 ELSE '' END)
         WHERE id = $3 AND label_id = $4`,
        [song, socials, rows[0].id, labelId]
      ).catch(() => {});
    }

    // Keep the vendor record current (contact + W9 for next time).
    upsertVendor(pool, labelId, {
      name: vendorName, email: vendorEmail, address: vendorAddress, bank: vendorBank,
      w9_r2_key: w9Key, w9_filename: w9Name,
    }).catch(() => {});

    // Save up to 4 extra emails against the vendor (auto-CC'd on confirmations).
    let extra = [];
    try { extra = JSON.parse(b.extra_emails || '[]'); } catch { extra = String(b.extra_emails || '').split(/[,;]/); }
    for (const raw of (Array.isArray(extra) ? extra : []).slice(0, 4)) {
      const em = String(raw || '').trim();
      if (em && isValidEmail(em) && em.toLowerCase() !== vendorEmail.toLowerCase()) {
        pool.query(
          `INSERT INTO vendor_emails (label_id, vendor, email, created_by) VALUES ($1,$2,$3,'Vendor form')
           ON CONFLICT (label_id, LOWER(vendor), LOWER(email)) DO NOTHING`,
          [labelId, vendorName, em]
        ).catch(() => {});
      }
    }

    // Background AI discrepancy scans (fire-and-forget; no key = graceful no-op).
    if (claude.isEnabled()) {
      aiScan.rescanInvoice(labelId, rows[0].id).catch(() => {});
      if (w9Key) aiScan.rescanW9(labelId, rows[0].id).catch(() => {});
    }

    // Audit it in the label's activity feed.
    pool.query(
      `INSERT INTO activity_log (label_id, action, detail, method, endpoint, created_at)
       VALUES ($1, 'Vendor submission received', $2, 'POST', $3, NOW())`,
      [labelId, `${vendorName} — ${invoiceNum}`, `/api/vendor/${label.slug}/submit`]
    ).catch(() => {});

    res.status(201).json({ success: true, data: { id: rows[0].id } });
  } catch (error) {
    console.error('Vendor submit error:', error);
    res.status(500).json({ success: false, error: 'Submission failed. Please try again.' });
  }
});

module.exports = router;
